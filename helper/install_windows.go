//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Double-clicking the downloaded .exe installs it.
const interactiveDefaultInstall = true

// Registry keys (under HKCU, or HKLM with --system) where browsers look up native hosts.
var registryBases = []string{
	`Software\Google\Chrome\NativeMessagingHosts`,
	`Software\Microsoft\Edge\NativeMessagingHosts`,
	`Software\BraveSoftware\Brave-Browser\NativeMessagingHosts`,
	`Software\Chromium\NativeMessagingHosts`,
	`Software\Vivaldi\NativeMessagingHosts`,
}

func installDir(system bool) string {
	if system {
		return filepath.Join(os.Getenv("ProgramFiles"), "IntelligentLabelPrinting")
	}
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "IntelligentLabelPrinting")
}

func rootKey(system bool) registry.Key {
	if system {
		return registry.LOCAL_MACHINE
	}
	return registry.CURRENT_USER
}

func install(o options) (string, error) {
	dir := installDir(o.system)
	exe := filepath.Join(dir, "ilp-host.exe")
	manifest := filepath.Join(dir, HostName+".json")
	wasInstalled := false
	if _, err := os.Stat(manifest); err == nil {
		wasInstalled = true
	}
	if err := copySelf(exe); err != nil {
		return "", err
	}
	os.Remove(exe + ".old")
	origins := mergeOrigins([]string{manifest}, o.extra)
	if err := os.WriteFile(manifest, manifestJSON(exe, origins), 0o644); err != nil {
		return "", err
	}
	for _, base := range registryBases {
		k, _, err := registry.CreateKey(rootKey(o.system), base+`\`+HostName, registry.SET_VALUE)
		if err != nil {
			return "", fmt.Errorf("registry %s: %v", base, err)
		}
		err = k.SetStringValue("", manifest)
		k.Close()
		if err != nil {
			return "", fmt.Errorf("registry %s: %v", base, err)
		}
	}
	head := "is installed"
	if wasInstalled {
		head = "was updated"
	}
	st, _ := status(o.system)
	return fmt.Sprintf("Intelligent label printing helper %s %s.\n\nYou can now print labels from the Chrome extension.\n(Restart Chrome if it was open.)\n\n%s", Version, head, st), nil
}

func status(system bool) (string, error) {
	lines := []string{"Registration:"}
	for _, base := range registryBases {
		browser := strings.Split(base, `\`)[1] + " " + strings.Split(base, `\`)[2]
		k, err := registry.OpenKey(rootKey(system), base+`\`+HostName, registry.QUERY_VALUE)
		if err != nil {
			lines = append(lines, fmt.Sprintf("  %s: not registered", browser))
			continue
		}
		v, _, err := k.GetStringValue("")
		k.Close()
		if err != nil {
			v = "(no value)"
		}
		lines = append(lines, fmt.Sprintf("  %s: %s", browser, v))
	}
	lines = append(lines, "Manifest:", describeManifest(filepath.Join(installDir(system), HostName+".json")))
	return strings.Join(lines, "\n"), nil
}

func uninstall(system bool) (string, error) {
	for _, base := range registryBases {
		registry.DeleteKey(rootKey(system), base+`\`+HostName)
	}
	dir := installDir(system)
	os.Remove(filepath.Join(dir, HostName+".json"))
	self, _ := os.Executable()
	exe := filepath.Join(dir, "ilp-host.exe")
	if !strings.EqualFold(self, exe) {
		os.Remove(exe)
		os.Remove(exe + ".old")
		os.Remove(dir)
	}
	return "Intelligent label printing helper has been removed.", nil
}

func report(msg string, err error) {
	title := "Intelligent label printing"
	flags := uint32(windows.MB_OK | windows.MB_ICONINFORMATION)
	if err != nil {
		msg = "Installation failed:\n\n" + err.Error()
		flags = windows.MB_OK | windows.MB_ICONERROR
	}
	fmt.Println(msg)
	// started by double-click: close our own console window, keep only the message box
	list := make([]uint32, 2)
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	if n, _, _ := kernel32.NewProc("GetConsoleProcessList").Call(uintptr(unsafe.Pointer(&list[0])), 2); n == 1 {
		kernel32.NewProc("FreeConsole").Call()
	}
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(msg)
	windows.MessageBox(0, m, t, flags)
	if err != nil {
		os.Exit(1)
	}
}
