//go:build linux

package sysinfo

import "syscall"

// Kernel — версия ядра (uname -r).
func Kernel() string {
	var uname syscall.Utsname
	if err := syscall.Uname(&uname); err != nil {
		return ""
	}

	return utsString(uname.Release[:])
}
