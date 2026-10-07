// Intelligent label printing – native messaging helper.
//
// Chrome starts this program with the extension origin as the first argument
// and talks to it over stdin/stdout (4-byte little-endian length + JSON).
// Run without arguments (double-click on Windows) or with "install" to
// register it with the browsers; "uninstall" removes it again.
package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const (
	Version  = "2.0.1"
	HostName = "com.intelligent_label_printing.host"
	maxChunk = 600 * 1024 // file bytes per message (helper -> Chrome is limited to 1 MB)
)

// Extension IDs allowed to talk to the helper.
var allowedOrigins = []string{
	"chrome-extension://fcfpnegfonhlplflgmjapjgkdcpdfkma/",
}

// Media is one paper size a printer offers. Sizes and margins are in mm.
type Media struct {
	Code    string   `json:"code"`
	Name    string   `json:"name"`
	W       float64  `json:"w,omitempty"`
	H       float64  `json:"h,omitempty"`
	Margins *Margins `json:"margins,omitempty"`
	Custom  bool     `json:"custom,omitempty"`
}

type Margins struct {
	L float64 `json:"l"`
	B float64 `json:"b"`
	R float64 `json:"r"`
	T float64 `json:"t"`
}

type Printer struct {
	Name            string  `json:"name"`
	IsDefault       bool    `json:"isDefault"`
	Media           []Media `json:"media"`
	DefaultMedia    string  `json:"defaultMedia"`
	CustomSupported bool    `json:"customSupported"`
	LastUsedMedia   string  `json:"lastUsedMedia"`
}

type PrintOptions struct {
	Copies  int    `json:"copies"`
	Media   string `json:"media"`
	Scaling string `json:"scaling"` // "none" | "fit"
}

type Request struct {
	Cmd     string   `json:"cmd"`
	Printer string   `json:"printer"`
	Title   string   `json:"title"`
	Data    string   `json:"data"`   // PDF (base64) – macOS / Linux
	Images  []string `json:"images"` // PNG pages (base64) – Windows
	Paper   *struct {
		W float64 `json:"w"`
		H float64 `json:"h"`
	} `json:"paper"`
	Options PrintOptions `json:"options"`
	Path    string       `json:"path"`
	Offset  int64        `json:"offset"`
}

type Response map[string]any

func fail(format string, a ...any) Response {
	return Response{"ok": false, "error": fmt.Sprintf(format, a...)}
}

func handle(req *Request) Response {
	switch req.Cmd {
	case "ping":
		return Response{"ok": true, "version": Version, "platform": runtime.GOOS, "format": printFormat}
	case "printers":
		printers, err := listPrinters()
		if err != nil {
			return fail("%v", err)
		}
		return Response{"ok": true, "printers": printers}
	case "printerInfo":
		return printerInfo(req)
	case "print":
		return printJob(req)
	case "read":
		return readFile(req)
	}
	return fail("Unknown command: %s", req.Cmd)
}

func readFile(req *Request) Response {
	path := req.Path
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}
	if !strings.HasSuffix(strings.ToLower(path), ".pdf") {
		return fail("The helper only reads .pdf files.")
	}
	f, err := os.Open(path)
	if err != nil {
		return fail("File not found: %s", path)
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		return fail("File not found: %s", path)
	}
	if _, err := f.Seek(req.Offset, io.SeekStart); err != nil {
		return fail("%v", err)
	}
	buf := make([]byte, maxChunk)
	n, _ := io.ReadFull(f, buf)
	return Response{
		"ok":     true,
		"size":   st.Size(),
		"offset": req.Offset,
		"data":   base64.StdEncoding.EncodeToString(buf[:n]),
		"eof":    req.Offset+int64(n) >= st.Size(),
	}
}

func serve() {
	var length uint32
	if err := binary.Read(os.Stdin, binary.LittleEndian, &length); err != nil {
		return
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(os.Stdin, body); err != nil {
		return
	}
	var resp Response
	var req Request
	if err := json.Unmarshal(body, &req); err != nil {
		resp = fail("Invalid request: %v", err)
	} else {
		func() {
			defer func() {
				if r := recover(); r != nil { // always answer so the extension never hangs
					resp = fail("Internal error: %v", r)
				}
			}()
			resp = handle(&req)
		}()
	}
	out, _ := json.Marshal(resp)
	binary.Write(os.Stdout, binary.LittleEndian, uint32(len(out)))
	os.Stdout.Write(out)
}

func usage() {
	fmt.Printf(`Intelligent label printing helper %s

  ilp-host install [--system] [--extension-id ID]
                                register the helper with Chrome, Edge, Brave and Chromium;
                                --extension-id also allows an extension with another ID
                                (e.g. one loaded unpacked); it can be repeated
  ilp-host uninstall [--system] remove the registration
  ilp-host status [--system]    show where the helper is registered
  ilp-host printers             list printers and paper sizes (for testing)
  ilp-host version
`, Version)
}

var reExtensionID = regexp.MustCompile(`^[a-p]{32}$`)

type options struct {
	system bool
	extra  []string // extra allowed origins
}

func parseOptions(args []string) (options, error) {
	var o options
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "--system":
			o.system = true
		case a == "--extension-id" && i+1 < len(args):
			i++
			id := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(args[i]), "chrome-extension://"), "/")
			if !reExtensionID.MatchString(id) {
				return o, fmt.Errorf("%q is not a valid extension ID (32 letters a-p)", args[i])
			}
			o.extra = append(o.extra, "chrome-extension://"+id+"/")
		default:
			return o, fmt.Errorf("unknown option %q", a)
		}
	}
	return o, nil
}

func main() {
	args := os.Args[1:]
	// Chrome passes the calling extension's origin (and on Windows --parent-window=…).
	if len(args) > 0 && strings.HasPrefix(args[0], "chrome-extension://") {
		serve()
		return
	}
	cmd := ""
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	opts, err := parseOptions(args)
	if err != nil {
		report("", err)
		return
	}
	switch cmd {
	case "", "install":
		if cmd == "" && !interactiveDefaultInstall {
			usage()
			return
		}
		report(install(opts))
	case "uninstall":
		report(uninstall(opts.system))
	case "status":
		report(status(opts.system))
	case "printers":
		p, err := listPrinters()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		out, _ := json.MarshalIndent(p, "", "  ")
		fmt.Println(string(out))
	case "version", "--version", "-v":
		fmt.Println(Version)
	default:
		usage()
	}
}
