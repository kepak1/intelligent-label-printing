package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// manifestJSON is the native messaging manifest pointing Chrome at the helper.
func manifestJSON(exePath string, origins []string) []byte {
	m := map[string]any{
		"name":            HostName,
		"description":     "Intelligent label printing – print helper",
		"path":            exePath,
		"type":            "stdio",
		"allowed_origins": origins,
	}
	out, _ := json.MarshalIndent(m, "", "  ")
	return out
}

type manifestFile struct {
	Path           string   `json:"path"`
	AllowedOrigins []string `json:"allowed_origins"`
}

func readManifest(file string) (*manifestFile, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	var m manifestFile
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// mergeOrigins keeps the built-in IDs, IDs added earlier (found in existing
// manifests) and the newly requested ones, without duplicates.
func mergeOrigins(existingManifests []string, extra []string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(o string) {
		if o != "" && !seen[o] {
			seen[o] = true
			out = append(out, o)
		}
	}
	for _, o := range allowedOrigins {
		add(o)
	}
	for _, f := range existingManifests {
		if m, err := readManifest(f); err == nil {
			for _, o := range m.AllowedOrigins {
				add(o)
			}
		}
	}
	for _, o := range extra {
		add(o)
	}
	return out
}

func describeManifest(file string) string {
	m, err := readManifest(file)
	if err != nil {
		return fmt.Sprintf("  %s\n    missing or unreadable (%v)", file, err)
	}
	exe := "OK"
	if _, err := os.Stat(m.Path); err != nil {
		exe = "MISSING"
	}
	return fmt.Sprintf("  %s\n    helper: %s (%s)\n    allowed: %s", file, m.Path, exe, strings.Join(m.AllowedOrigins, ", "))
}

// copySelf copies the running executable to dst (fresh bytes, so no
// "downloaded from the internet" marks are carried over).
func copySelf(dst string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self, _ = filepath.EvalSymlinks(self)
	if abs, _ := filepath.Abs(dst); abs == self {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(self)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	out.Close()
	// replacing a running helper can fail on Windows – move the old one aside first
	if _, err := os.Stat(dst); err == nil {
		os.Remove(dst + ".old")
		if err := os.Rename(dst, dst+".old"); err != nil {
			return fmt.Errorf("cannot replace %s (close Chrome and try again): %v", dst, err)
		}
	}
	return os.Rename(tmp, dst)
}

func writeManifest(dir, exePath string, origins []string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, HostName+".json"), manifestJSON(exePath, origins), 0o644)
}
