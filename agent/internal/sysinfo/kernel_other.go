//go:build !linux

package sysinfo

// Kernel — версия ядра; вне Linux воркер её не сообщает.
func Kernel() string { return "" }
