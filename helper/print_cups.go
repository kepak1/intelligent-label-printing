//go:build !windows

// Printing on macOS / Linux through CUPS (lp, lpstat, lpoptions).
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

// The extension sends the finished PDF; CUPS renders it.
const printFormat = "pdf"

const ptToMM = 25.4 / 72

func mm(pt float64) float64 { return math.Round(pt*ptToMM*10) / 10 }

func run(name string, args ...string) (string, string, error) {
	cmd := exec.Command(name, args...)
	// prefer English output (macOS may still localise some messages)
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C", "CUPS_LANG=C")
	var out, errb strings.Builder
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	return out.String(), errb.String(), err
}

type ppdData struct {
	sizes map[string]Media      // PaperDimension: name and size
	areas map[string][4]float64 // ImageableArea in points
}

var ppdLine = regexp.MustCompile(`^\*(PaperDimension|ImageableArea)\s+([^/:\s]+)(?:/([^:]*))?:\s*"([^"]+)"`)

// readPPD returns media names, sizes and printable areas from the printer's PPD.
func readPPD(printer string) ppdData {
	d := ppdData{sizes: map[string]Media{}, areas: map[string][4]float64{}}
	f, err := os.Open(filepath.Join("/etc/cups/ppd", printer+".ppd"))
	if err != nil {
		return d
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	for sc.Scan() {
		m := ppdLine.FindStringSubmatch(latin1(sc.Bytes()))
		if m == nil {
			continue
		}
		var vals []float64
		for _, s := range strings.Fields(m[4]) {
			v, err := strconv.ParseFloat(s, 64)
			if err != nil {
				vals = nil
				break
			}
			vals = append(vals, v)
		}
		name := strings.TrimSpace(m[3])
		if name == "" {
			name = m[2]
		}
		if m[1] == "PaperDimension" && len(vals) == 2 {
			d.sizes[m[2]] = Media{Code: m[2], Name: name, W: vals[0], H: vals[1]}
		} else if m[1] == "ImageableArea" && len(vals) == 4 {
			d.areas[m[2]] = [4]float64{vals[0], vals[1], vals[2], vals[3]}
		}
	}
	return d
}

func latin1(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

var (
	reWH = regexp.MustCompile(`^w(\d+(?:\.\d+)?)h(\d+(?:\.\d+)?)$`)
	reMM = regexp.MustCompile(`(?i)^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm`)
)

// sizeFromCode guesses a size (points) from codes like w288h432, 100x150mm, A4.
func sizeFromCode(code string) (float64, float64, bool) {
	if m := reWH.FindStringSubmatch(code); m != nil {
		w, _ := strconv.ParseFloat(m[1], 64)
		h, _ := strconv.ParseFloat(m[2], 64)
		return w, h, true
	}
	if m := reMM.FindStringSubmatch(code); m != nil {
		w, _ := strconv.ParseFloat(m[1], 64)
		h, _ := strconv.ParseFloat(m[2], 64)
		return w / ptToMM, h / ptToMM, true
	}
	switch code {
	case "A4":
		return 595.28, 841.89, true
	case "A6":
		return 297.64, 419.53, true
	case "Letter":
		return 612, 792, true
	}
	return 0, 0, false
}

func describeMedia(code string, ppd ppdData) Media {
	m := Media{Code: code, Name: code}
	var w, h float64
	var ok bool
	if s, found := ppd.sizes[code]; found {
		m.Name, w, h, ok = s.Name, s.W, s.H, true
	} else {
		w, h, ok = sizeFromCode(code)
	}
	if ok {
		m.W, m.H = mm(w), mm(h)
		if a, found := ppd.areas[code]; found {
			m.Margins = &Margins{L: mm(a[0]), B: mm(a[1]), R: mm(math.Max(0, w-a[2])), T: mm(math.Max(0, h-a[3]))}
		}
	}
	return m
}

// macCustomPapers returns the custom sizes defined in the macOS print dialog.
func macCustomPapers() []Media {
	if runtime.GOOS != "darwin" {
		return nil
	}
	home, _ := os.UserHomeDir()
	out, _, err := run("plutil", "-convert", "json", "-o", "-", filepath.Join(home, "Library/Preferences/com.apple.print.custompapers.plist"))
	if err != nil {
		return nil
	}
	var data map[string]map[string]any
	if json.Unmarshal([]byte(out), &data) != nil {
		return nil
	}
	num := func(p map[string]any, k string) float64 { v, _ := p[k].(float64); return v }
	var papers []Media
	for key, p := range data {
		w, h := num(p, "width"), num(p, "height")
		if w <= 0 || h <= 0 {
			continue
		}
		name, _ := p["name"].(string)
		if name == "" {
			name = key
		}
		papers = append(papers, Media{
			// the same code the macOS print dialog sends to CUPS (size in points)
			Code:    fmt.Sprintf("Custom.%.2fx%.2f", w, h),
			Name:    name,
			W:       mm(w),
			H:       mm(h),
			Margins: &Margins{L: mm(num(p, "left")), B: mm(num(p, "bottom")), R: mm(num(p, "right")), T: mm(num(p, "top"))},
			Custom:  true,
		})
	}
	sort.Slice(papers, func(i, j int) bool { return papers[i].Name < papers[j].Name })
	return papers
}

var reLastUsed = regexp.MustCompile(`"com\.apple\.print\.PageToPaperMappingMediaName"\s*=\s*"([^"]+)"`)

// macLastUsedMedia is the paper last used for this printer in the macOS print dialog.
func macLastUsedMedia(printer string) string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	out, _, err := run("defaults", "read", "com.apple.print.custompresets.forprinter."+printer, "com.apple.print.v2.lastUsedSettingsPref")
	if err != nil {
		return ""
	}
	if m := reLastUsed.FindStringSubmatch(out); m != nil {
		return m[1]
	}
	return ""
}

var reDefault = regexp.MustCompile(`:\s*(\S+)\s*$`)

func listPrinters() ([]Printer, error) {
	out, _, err := run("lpstat", "-e")
	if err != nil {
		return nil, fmt.Errorf("lpstat failed: %v", err)
	}
	def := ""
	if d, _, err := run("lpstat", "-d"); err == nil {
		if m := reDefault.FindStringSubmatch(strings.TrimSpace(d)); m != nil {
			def = m[1]
		}
	}
	custom := macCustomPapers()
	printers := []Printer{}
	for _, name := range strings.Fields(out) {
		p := Printer{Name: name, IsDefault: name == def, Media: []Media{}, LastUsedMedia: macLastUsedMedia(name)}
		ppd := readPPD(name)
		opts, _, _ := run("lpoptions", "-p", name, "-l")
		for _, line := range strings.Split(opts, "\n") {
			if !strings.HasPrefix(line, "PageSize/") {
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			if len(parts) < 2 {
				continue
			}
			for _, tok := range strings.Fields(parts[1]) {
				if strings.HasPrefix(tok, "Custom.") {
					p.CustomSupported = true
					continue
				}
				code := strings.TrimPrefix(tok, "*")
				if strings.HasPrefix(tok, "*") {
					p.DefaultMedia = code
				}
				p.Media = append(p.Media, describeMedia(code, ppd))
			}
		}
		if p.CustomSupported {
			p.Media = append(append([]Media{}, custom...), p.Media...)
		}
		printers = append(printers, p)
	}
	return printers, nil
}

// CUPS renders the PDF itself; margins come with the media list.
func printerInfo(req *Request) Response { return Response{"ok": true, "dpi": 300} }

var reJob = regexp.MustCompile(`(\S+-\d+)\s*\(`)

func printJob(req *Request) Response {
	if req.Printer != "" {
		out, _, _ := run("lpstat", "-e")
		found := false
		for _, n := range strings.Fields(out) {
			found = found || n == req.Printer
		}
		if !found {
			return Response{"ok": false, "code": "PRINTER_MISSING", "error": fmt.Sprintf("Printer %q is not installed on this computer.", req.Printer)}
		}
	}
	data, err := base64.StdEncoding.DecodeString(req.Data)
	if err != nil || len(data) == 0 {
		return fail("No PDF data received.")
	}
	f, err := os.CreateTemp("", "ilp_*.pdf")
	if err != nil {
		return fail("%v", err)
	}
	defer os.Remove(f.Name())
	f.Write(data)
	f.Close()

	args := []string{}
	if req.Printer != "" {
		args = append(args, "-d", req.Printer)
	}
	if req.Options.Copies > 1 {
		args = append(args, "-n", strconv.Itoa(req.Options.Copies))
	}
	if req.Options.Media != "" {
		args = append(args, "-o", "media="+req.Options.Media)
	}
	if req.Options.Scaling == "fit" {
		args = append(args, "-o", "print-scaling=fit", "-o", "fit-to-page")
	} else {
		args = append(args, "-o", "print-scaling=none")
	}
	title := req.Title
	if title == "" {
		title = "Label"
	}
	if len(title) > 100 {
		title = title[:100]
	}
	args = append(args, "-t", title, f.Name())
	out, errOut, err := run("lp", args...)
	if err != nil {
		msg := strings.TrimSpace(errOut + out)
		if msg == "" {
			msg = err.Error()
		}
		return Response{"ok": false, "error": msg, "cmd": append([]string{"lp"}, args[:len(args)-1]...)}
	}
	job := strings.TrimSpace(out)
	if m := reJob.FindStringSubmatch(out); m != nil {
		job = m[1]
	}
	return Response{"ok": true, "job": job}
}
