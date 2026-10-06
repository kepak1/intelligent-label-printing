package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// manifestJSON is the native messaging manifest pointing Chrome at the helper.
func manifestJSON(exePath string) []byte {
	m := map[string]any{
		"name":            HostName,
		"description":     "Intelligent label printing – print helper",
		"path":            exePath,
		"type":            "stdio",
		"allowed_origins": allowedOrigins,
	}
	out, _ := json.MarshalIndent(m, "", "  ")
	return out
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

func writeManifest(dir, exePath string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, HostName+".json"), manifestJSON(exePath), 0o644)
}
