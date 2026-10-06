//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const interactiveDefaultInstall = false

func userAppDir() string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "IntelligentLabelPrinting")
	}
	return filepath.Join(home, ".local", "share", "intelligent-label-printing")
}

// manifestDirs lists where browsers look for native messaging manifests.
// `always` is written even if that browser's profile folder does not exist yet.
func manifestDirs(system bool) (dirs []string, always string) {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		if system {
			return []string{
				"/Library/Google/Chrome/NativeMessagingHosts",
				"/Library/Microsoft/Edge/NativeMessagingHosts",
				"/Library/Application Support/Chromium/NativeMessagingHosts",
				"/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
			}, ""
		}
		as := filepath.Join(home, "Library", "Application Support")
		chrome := filepath.Join(as, "Google", "Chrome", "NativeMessagingHosts")
		return []string{
			chrome,
			filepath.Join(as, "Chromium", "NativeMessagingHosts"),
			filepath.Join(as, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
			filepath.Join(as, "Microsoft Edge", "NativeMessagingHosts"),
			filepath.Join(as, "Vivaldi", "NativeMessagingHosts"),
			filepath.Join(as, "Arc", "User Data", "NativeMessagingHosts"),
		}, chrome
	}
	if system {
		return []string{
			"/etc/opt/chrome/native-messaging-hosts",
			"/etc/chromium/native-messaging-hosts",
			"/etc/opt/edge/native-messaging-hosts",
		}, ""
	}
	cfg := filepath.Join(home, ".config")
	chrome := filepath.Join(cfg, "google-chrome", "NativeMessagingHosts")
	return []string{
		chrome,
		filepath.Join(cfg, "chromium", "NativeMessagingHosts"),
		filepath.Join(cfg, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
		filepath.Join(cfg, "microsoft-edge", "NativeMessagingHosts"),
	}, chrome
}

func install(system bool) (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, _ = filepath.EvalSymlinks(exe)
	if !system {
		// per-user install: keep a copy of the helper in the user's app folder
		target := filepath.Join(userAppDir(), "ilp-host")
		if err := copySelf(target); err != nil {
			return "", err
		}
		exe = target
	}
	dirs, always := manifestDirs(system)
	var done []string
	for _, d := range dirs {
		// write only for installed browsers (their profile root exists), Chrome always
		if d != always && !system {
			if _, err := os.Stat(filepath.Dir(d)); err != nil {
				continue
			}
		}
		if err := writeManifest(d, exe); err != nil {
			return "", fmt.Errorf("%s: %v", d, err)
		}
		done = append(done, d)
	}
	return fmt.Sprintf("Intelligent label printing helper %s installed.\nHelper: %s\nRegistered in:\n  %s", Version, exe, strings.Join(done, "\n  ")), nil
}

func uninstall(system bool) (string, error) {
	dirs, _ := manifestDirs(system)
	for _, d := range dirs {
		os.Remove(filepath.Join(d, HostName+".json"))
	}
	if !system {
		os.RemoveAll(userAppDir())
	}
	return "Intelligent label printing helper removed.", nil
}

func report(msg string, err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
	fmt.Println(msg)
}
