//go:build windows

// Printing on Windows through the printer driver (winspool + GDI).
//
// Windows has no built-in way to print a PDF from the command line, so the
// extension renders every page to a PNG at the printer's resolution and the
// helper draws it on the page with exactly the paper size the profile wants.
// Label printers are raster devices anyway, so nothing is lost.
package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const printFormat = "image"

var (
	winspool = windows.NewLazySystemDLL("winspool.drv")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")

	pEnumPrinters       = winspool.NewProc("EnumPrintersW")
	pGetDefaultPrinter  = winspool.NewProc("GetDefaultPrinterW")
	pOpenPrinter        = winspool.NewProc("OpenPrinterW")
	pClosePrinter       = winspool.NewProc("ClosePrinter")
	pDocumentProperties = winspool.NewProc("DocumentPropertiesW")
	pDeviceCapabilities = winspool.NewProc("DeviceCapabilitiesW")
	pEnumForms          = winspool.NewProc("EnumFormsW")
	pCreateDC           = gdi32.NewProc("CreateDCW")
	pDeleteDC           = gdi32.NewProc("DeleteDC")
	pStartDoc           = gdi32.NewProc("StartDocW")
	pEndDoc             = gdi32.NewProc("EndDoc")
	pAbortDoc           = gdi32.NewProc("AbortDoc")
	pStartPage          = gdi32.NewProc("StartPage")
	pEndPage            = gdi32.NewProc("EndPage")
	pGetDeviceCaps      = gdi32.NewProc("GetDeviceCaps")
	pStretchDIBits      = gdi32.NewProc("StretchDIBits")
	pSetStretchBltMode  = gdi32.NewProc("SetStretchBltMode")
	pSetBrushOrgEx      = gdi32.NewProc("SetBrushOrgEx")
)

const (
	printerEnumLocal       = 0x2
	printerEnumConnections = 0x4

	dcPapers     = 2
	dcPaperSize  = 3
	dcPaperNames = 16

	dmOutBuffer = 2
	dmInBuffer  = 8

	dmFieldOrientation = 0x1
	dmFieldPaperSize   = 0x2
	dmFieldPaperLength = 0x4
	dmFieldPaperWidth  = 0x8
	dmFieldFormName    = 0x10000
	dmpaperUser        = 256

	horzRes         = 8
	vertRes         = 10
	logPixelsX      = 88
	logPixelsY      = 90
	physicalWidth   = 110
	physicalHeight  = 111
	physicalOffsetX = 112
	physicalOffsetY = 113

	halftone = 4
	srcCopy  = 0x00CC0020

	formUser = 0
)

// DEVMODEW field offsets (bytes) – identical on 32 and 64 bit.
const (
	offDmSize        = 68
	offDmDriverExtra = 70
	offDmFields      = 72
	offOrientation   = 76
	offPaperSize     = 78
	offPaperLength   = 80
	offPaperWidth    = 82
	offFormName      = 102
)

func u16(s string) *uint16 { p, _ := windows.UTF16PtrFromString(s); return p }

func defaultPrinter() string {
	var n uint32
	pGetDefaultPrinter.Call(0, uintptr(unsafe.Pointer(&n)))
	if n == 0 {
		return ""
	}
	buf := make([]uint16, n)
	if r, _, _ := pGetDefaultPrinter.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return ""
	}
	return windows.UTF16ToString(buf)
}

func printerNames() ([]string, error) {
	type printerInfo4 struct {
		Name       *uint16
		ServerName *uint16
		Attributes uint32
	}
	flags := uintptr(printerEnumLocal | printerEnumConnections)
	var needed, count uint32
	pEnumPrinters.Call(flags, 0, 4, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count)))
	if needed == 0 {
		return nil, nil
	}
	buf := make([]byte, needed)
	r, _, err := pEnumPrinters.Call(flags, 0, 4, uintptr(unsafe.Pointer(&buf[0])), uintptr(needed),
		uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count)))
	if r == 0 {
		return nil, fmt.Errorf("EnumPrinters: %v", err)
	}
	infos := unsafe.Slice((*printerInfo4)(unsafe.Pointer(&buf[0])), count)
	names := make([]string, 0, count)
	for _, in := range infos {
		names = append(names, windows.UTF16PtrToString(in.Name))
	}
	return names, nil
}

func openPrinter(name string) (uintptr, error) {
	var h uintptr
	r, _, err := pOpenPrinter.Call(uintptr(unsafe.Pointer(u16(name))), uintptr(unsafe.Pointer(&h)), 0)
	if r == 0 {
		return 0, fmt.Errorf("printer %q is not available: %v", name, err)
	}
	return h, nil
}

// devMode returns the printer's default DEVMODE as raw bytes.
func devMode(h uintptr, name string) ([]byte, error) {
	size, _, err := pDocumentProperties.Call(0, h, uintptr(unsafe.Pointer(u16(name))), 0, 0, 0)
	if int32(size) <= 0 {
		return nil, fmt.Errorf("DocumentProperties: %v", err)
	}
	dm := make([]byte, size)
	r, _, err := pDocumentProperties.Call(0, h, uintptr(unsafe.Pointer(u16(name))), uintptr(unsafe.Pointer(&dm[0])), 0, dmOutBuffer)
	if int32(r) < 0 {
		return nil, fmt.Errorf("DocumentProperties: %v", err)
	}
	return dm, nil
}

func getU16(b []byte, off int) uint16    { return *(*uint16)(unsafe.Pointer(&b[off])) }
func setU16(b []byte, off int, v uint16) { *(*uint16)(unsafe.Pointer(&b[off])) = v }
func getU32(b []byte, off int) uint32    { return *(*uint32)(unsafe.Pointer(&b[off])) }
func setU32(b []byte, off int, v uint32) { *(*uint32)(unsafe.Pointer(&b[off])) = v }

func formName(dm []byte) string {
	return windows.UTF16ToString(unsafe.Slice((*uint16)(unsafe.Pointer(&dm[offFormName])), 32))
}

func deviceCaps(name string, capability int, out unsafe.Pointer) int {
	r, _, _ := pDeviceCapabilities.Call(uintptr(unsafe.Pointer(u16(name))), 0, uintptr(capability), uintptr(out), 0)
	return int(int32(r))
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// driverPapers lists the paper sizes the driver offers (code "paper:<id>").
func driverPapers(name string) []Media {
	n := deviceCaps(name, dcPapers, nil)
	if n <= 0 {
		return nil
	}
	ids := make([]uint16, n)
	deviceCaps(name, dcPapers, unsafe.Pointer(&ids[0]))
	sizes := make([]struct{ X, Y int32 }, n) // tenths of a millimetre
	deviceCaps(name, dcPaperSize, unsafe.Pointer(&sizes[0]))
	names := make([]uint16, n*64)
	deviceCaps(name, dcPaperNames, unsafe.Pointer(&names[0]))
	media := make([]Media, 0, n)
	for i := 0; i < n; i++ {
		label := windows.UTF16ToString(names[i*64 : (i+1)*64])
		media = append(media, Media{
			Code: fmt.Sprintf("paper:%d", ids[i]),
			Name: label,
			W:    round1(float64(sizes[i].X) / 10),
			H:    round1(float64(sizes[i].Y) / 10),
		})
	}
	return media
}

// userForms lists custom forms created in "Print server properties" (code "form:<name>").
func userForms(h uintptr) []Media {
	type formInfo1 struct {
		Flags         uint32
		Name          *uint16
		Width, Height int32 // thousandths of a millimetre
		Left, Top     int32
		Right, Bottom int32
	}
	var needed, count uint32
	pEnumForms.Call(h, 1, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count)))
	if needed == 0 {
		return nil
	}
	buf := make([]byte, needed)
	if r, _, _ := pEnumForms.Call(h, 1, uintptr(unsafe.Pointer(&buf[0])), uintptr(needed),
		uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count))); r == 0 {
		return nil
	}
	var media []Media
	for _, f := range unsafe.Slice((*formInfo1)(unsafe.Pointer(&buf[0])), count) {
		if f.Flags != formUser {
			continue
		}
		name := windows.UTF16PtrToString(f.Name)
		media = append(media, Media{
			Code:   "form:" + name,
			Name:   name,
			W:      round1(float64(f.Width) / 1000),
			H:      round1(float64(f.Height) / 1000),
			Custom: true,
		})
	}
	return media
}

func listPrinters() ([]Printer, error) {
	names, err := printerNames()
	if err != nil {
		return nil, err
	}
	def := defaultPrinter()
	printers := []Printer{}
	for _, name := range names {
		p := Printer{Name: name, IsDefault: name == def, Media: []Media{}, CustomSupported: true}
		if h, err := openPrinter(name); err == nil {
			p.Media = append(p.Media, userForms(h)...)
			if dm, err := devMode(h, name); err == nil {
				if getU32(dm, offDmFields)&dmFieldPaperSize != 0 && getU16(dm, offPaperSize) != 0 {
					p.DefaultMedia = fmt.Sprintf("paper:%d", getU16(dm, offPaperSize))
				} else if fn := formName(dm); fn != "" {
					p.DefaultMedia = "form:" + fn
				}
			}
			pClosePrinter.Call(h)
		}
		p.Media = append(p.Media, driverPapers(name)...)
		printers = append(printers, p)
	}
	return printers, nil
}

var reCustom = regexp.MustCompile(`(?i)^Custom\.(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm)?$`)

// jobDevMode builds a DEVMODE for the job: the requested paper, orientation
// following the page shape, and everything else from the printer defaults.
func jobDevMode(h uintptr, name string, req *Request) ([]byte, error) {
	dm, err := devMode(h, name)
	if err != nil {
		return nil, err
	}
	fields := getU32(dm, offDmFields)
	media := req.Options.Media
	var wMM, hMM float64
	if req.Paper != nil {
		wMM, hMM = req.Paper.W, req.Paper.H
	}
	switch {
	case strings.HasPrefix(media, "paper:"):
		id, _ := strconv.Atoi(strings.TrimPrefix(media, "paper:"))
		setU16(dm, offPaperSize, uint16(id))
		fields |= dmFieldPaperSize
		fields &^= dmFieldPaperLength | dmFieldPaperWidth
	case strings.HasPrefix(media, "form:"):
		name16, _ := windows.UTF16FromString(strings.TrimPrefix(media, "form:"))
		if len(name16) > 32 {
			name16 = name16[:31]
			name16 = append(name16, 0)
		}
		for i := 0; i < 32; i++ {
			v := uint16(0)
			if i < len(name16) {
				v = name16[i]
			}
			setU16(dm, offFormName+2*i, v)
		}
		fields |= dmFieldFormName
		fields &^= dmFieldPaperSize | dmFieldPaperLength | dmFieldPaperWidth
	case reCustom.MatchString(media):
		m := reCustom.FindStringSubmatch(media)
		wMM, _ = strconv.ParseFloat(m[1], 64)
		hMM, _ = strconv.ParseFloat(m[2], 64)
		if m[3] == "" { // size in points, as macOS writes it
			wMM, hMM = wMM*25.4/72, hMM*25.4/72
		}
		short, long := math.Min(wMM, hMM), math.Max(wMM, hMM)
		setU16(dm, offPaperSize, dmpaperUser)
		setU16(dm, offPaperWidth, uint16(math.Round(short*10)))
		setU16(dm, offPaperLength, uint16(math.Round(long*10)))
		fields |= dmFieldPaperSize | dmFieldPaperWidth | dmFieldPaperLength
	}
	// landscape pages print on portrait paper rotated by the driver
	if wMM > 0 && hMM > 0 {
		orient := uint16(1)
		if wMM > hMM {
			orient = 2
		}
		setU16(dm, offOrientation, orient)
		fields |= dmFieldOrientation
	}
	setU32(dm, offDmFields, fields)
	// let the driver validate and merge the changes
	out := make([]byte, len(dm))
	r, _, err := pDocumentProperties.Call(0, h, uintptr(unsafe.Pointer(u16(name))),
		uintptr(unsafe.Pointer(&out[0])), uintptr(unsafe.Pointer(&dm[0])), dmInBuffer|dmOutBuffer)
	if int32(r) < 0 {
		return nil, fmt.Errorf("the driver rejected the paper settings: %v", err)
	}
	return out, nil
}

func createDC(name string, dm []byte) (uintptr, error) {
	hdc, _, err := pCreateDC.Call(uintptr(unsafe.Pointer(u16("WINSPOOL"))), uintptr(unsafe.Pointer(u16(name))), 0, uintptr(unsafe.Pointer(&dm[0])))
	if hdc == 0 {
		return 0, fmt.Errorf("cannot open printer %q: %v", name, err)
	}
	return hdc, nil
}

func caps(hdc uintptr, index int) int {
	r, _, _ := pGetDeviceCaps.Call(hdc, uintptr(index))
	return int(int32(r))
}

func withPrinter(req *Request, fn func(hdc uintptr) error) error {
	name := req.Printer
	if name == "" {
		name = defaultPrinter()
	}
	h, err := openPrinter(name)
	if err != nil {
		return err
	}
	defer pClosePrinter.Call(h)
	dm, err := jobDevMode(h, name, req)
	if err != nil {
		return err
	}
	hdc, err := createDC(name, dm)
	if err != nil {
		return err
	}
	defer pDeleteDC.Call(hdc)
	return fn(hdc)
}

// printerInfo tells the extension at which resolution to render the pages and
// which edges of the selected paper the printer cannot print on.
func printerInfo(req *Request) Response {
	res := Response{"ok": true, "dpi": 300}
	err := withPrinter(req, func(hdc uintptr) error {
		dpiX, dpiY := caps(hdc, logPixelsX), caps(hdc, logPixelsY)
		if dpiX <= 0 || dpiY <= 0 {
			return nil
		}
		res["dpi"] = dpiX
		physW, physH := caps(hdc, physicalWidth), caps(hdc, physicalHeight)
		offX, offY := caps(hdc, physicalOffsetX), caps(hdc, physicalOffsetY)
		areaW, areaH := caps(hdc, horzRes), caps(hdc, vertRes)
		toMM := func(px, dpi int) float64 { return round1(math.Max(0, float64(px)) * 25.4 / float64(dpi)) }
		res["margins"] = Margins{
			L: toMM(offX, dpiX),
			T: toMM(offY, dpiY),
			R: toMM(physW-areaW-offX, dpiX),
			B: toMM(physH-areaH-offY, dpiY),
		}
		res["pageMM"] = []float64{toMM(physW, dpiX), toMM(physH, dpiY)}
		return nil
	})
	if err != nil {
		return fail("%v", err)
	}
	return res
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// toDIB converts an image to a top-down 24-bit BGR bitmap.
func toDIB(img image.Image) ([]byte, int, int) {
	b := img.Bounds()
	rgba := image.NewNRGBA(b)
	// flatten transparency onto white
	draw.Draw(rgba, b, image.White, image.Point{}, draw.Src)
	draw.Draw(rgba, b, img, b.Min, draw.Over)
	w, h := b.Dx(), b.Dy()
	stride := (w*3 + 3) &^ 3
	out := make([]byte, stride*h)
	for y := 0; y < h; y++ {
		row := rgba.Pix[y*rgba.Stride:]
		dst := out[y*stride:]
		for x := 0; x < w; x++ {
			dst[x*3], dst[x*3+1], dst[x*3+2] = row[x*4+2], row[x*4+1], row[x*4]
		}
	}
	return out, w, h
}

func drawPage(hdc uintptr, img image.Image, fit bool) error {
	bits, w, h := toDIB(img)
	bmi := bitmapInfoHeader{Size: 40, Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 24}

	// device coordinates start at the printable area, the image covers the whole sheet
	physW, physH := caps(hdc, physicalWidth), caps(hdc, physicalHeight)
	offX, offY := caps(hdc, physicalOffsetX), caps(hdc, physicalOffsetY)
	x, y, dw, dh := -offX, -offY, physW, physH
	if fit {
		areaW, areaH := caps(hdc, horzRes), caps(hdc, vertRes)
		s := math.Min(float64(areaW)/float64(w), float64(areaH)/float64(h))
		dw, dh = int(float64(w)*s), int(float64(h)*s)
		x, y = (areaW-dw)/2, (areaH-dh)/2
	}
	pSetStretchBltMode.Call(hdc, halftone)
	pSetBrushOrgEx.Call(hdc, 0, 0, 0)
	r, _, err := pStretchDIBits.Call(hdc, uintptr(x), uintptr(y), uintptr(dw), uintptr(dh),
		0, 0, uintptr(w), uintptr(h), uintptr(unsafe.Pointer(&bits[0])), uintptr(unsafe.Pointer(&bmi)), 0, srcCopy)
	if int32(r) <= 0 {
		return fmt.Errorf("drawing the label failed: %v", err)
	}
	return nil
}

func printJob(req *Request) Response {
	if len(req.Images) == 0 {
		return fail("No page images received.")
	}
	pages := make([]image.Image, 0, len(req.Images))
	for i, b64 := range req.Images {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return fail("page %d: %v", i+1, err)
		}
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return fail("page %d: %v", i+1, err)
		}
		pages = append(pages, img)
	}
	copies := req.Options.Copies
	if copies < 1 {
		copies = 1
	}
	title := req.Title
	if title == "" {
		title = "Label"
	}
	err := withPrinter(req, func(hdc uintptr) error {
		type docInfo struct {
			Size     int32
			DocName  *uint16
			Output   *uint16
			Datatype *uint16
			Type     uint32
		}
		di := docInfo{DocName: u16(title)}
		di.Size = int32(unsafe.Sizeof(di))
		if r, _, err := pStartDoc.Call(hdc, uintptr(unsafe.Pointer(&di))); int32(r) <= 0 {
			return fmt.Errorf("StartDoc: %v", err)
		}
		for c := 0; c < copies; c++ {
			for _, img := range pages {
				pStartPage.Call(hdc)
				if err := drawPage(hdc, img, req.Options.Scaling == "fit"); err != nil {
					pAbortDoc.Call(hdc)
					return err
				}
				pEndPage.Call(hdc)
			}
		}
		pEndDoc.Call(hdc)
		return nil
	})
	if err != nil {
		return fail("%v", err)
	}
	return Response{"ok": true, "job": title}
}
