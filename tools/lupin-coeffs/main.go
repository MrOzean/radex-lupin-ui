// Command lupin-coeffs reads the factory calibration coefficients of a
// RADEX LUPIN device from its USB serial number string (iSerial descriptor)
// and prints them as JSON. The browser cannot access USB descriptors via
// Web Serial, so this standalone utility is the bridge: run it once and
// copy lumDiv / multiplier into the web app.
//
// Serial string layout (docs/research/radexlight-protocol.ru.md §12):
//
//	0  u32   serial number
//	4  u16   production year
//	6  u8    month
//	7  u8    day
//	8  u16   flags
//	10 u16   country code
//	12 u32   reserved
//	16 f32   luminance divisor (lumDiv)
//	20 f32   default correction multiplier
//	24 u16   firmware marker (13 => 1.3, 14 => 1.4)
//
// Usage: lupin-coeffs [flags]
//
// Windows: CIM query via powershell.exe (built-in).
// macOS:   system_profiler -json, fallback to ioreg.
// Linux:   /sys/bus/usb/devices, no external tools.
package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	vid = "abba"
	pid = "e011"
)

type coefficients struct {
	SerialNumber   uint32  `json:"serialNumber"`
	ProductionDate string  `json:"productionDate"`
	CountryCode    uint16  `json:"countryCode"`
	LumDiv         float64 `json:"lumDiv"`
	Multiplier     float64 `json:"multiplier"`
	FirmwareMarker uint16  `json:"firmwareMarker"`
	Raw            string  `json:"raw"`
}

func parseSerial(hex string) (coefficients, error) {
	var c coefficients
	norm := normalizeHex(hex)
	if len(norm) < 24 {
		return c, fmt.Errorf("serial string too short: %q", hex)
	}
	raw, err := hexDecode(norm)
	if err != nil {
		return c, fmt.Errorf("serial string is not hex: %q", hex)
	}
	c = coefficients{
		SerialNumber:   binary.LittleEndian.Uint32(raw[0:4]),
		ProductionDate: fmt.Sprintf("%04d-%02d-%02d", binary.LittleEndian.Uint16(raw[4:6]), raw[6], raw[7]),
		CountryCode:    binary.LittleEndian.Uint16(raw[10:12]),
		LumDiv:         round6(float64(math.Float32frombits(binary.LittleEndian.Uint32(raw[16:20])))),
		Multiplier:     round6(float64(math.Float32frombits(binary.LittleEndian.Uint32(raw[20:24])))),
		FirmwareMarker: binary.LittleEndian.Uint16(raw[24:26]),
		Raw:            norm,
	}
	return c, nil
}

func main() {
	plain := flag.Bool("plain", false, "print key=value lines instead of JSON")
	flag.Parse()

	serial, err := readSerial(runtime.GOOS)
	if err != nil {
		fatal(err)
	}
	c, err := parseSerial(serial)
	if err != nil {
		fatal(err)
	}

	if *plain {
		fmt.Printf("serialNumber:   %d\n", c.SerialNumber)
		fmt.Printf("productionDate: %s\n", c.ProductionDate)
		fmt.Printf("countryCode:    %d\n", c.CountryCode)
		fmt.Printf("lumDiv:         %g\n", c.LumDiv)
		fmt.Printf("multiplier:     %g\n", c.Multiplier)
		fmt.Printf("firmwareMarker: %d\n", c.FirmwareMarker)
		fmt.Printf("\nВ приложении введите: пересчёт яркости = %g, множитель = %g\n", c.LumDiv, c.Multiplier)
		return
	}
	out, _ := json.MarshalIndent(c, "", "  ")
	fmt.Println(string(out))
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "lupin-coeffs:", err)
	os.Exit(1)
}

// ---------------------------------------------------------------------------
// Platform readers
// ---------------------------------------------------------------------------

func readSerial(goos string) (string, error) {
	switch goos {
	case "windows":
		return readSerialWindows()
	case "darwin":
		return readSerialMac()
	default:
		return readSerialLinux()
	}
}

func readSerialWindows() (string, error) {
	const ps = "Get-CimInstance Win32_PnPEntity -Filter \"DeviceID LIKE 'USB%VID_ABBA%PID_E011%'\" |" +
		" Select-Object -First 1 -ExpandProperty DeviceID"
	out, err := run("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps)
	if err != nil {
		return "", err
	}
	return extractTrailingHex(out)
}

func readSerialMac() (string, error) {
	if out, err := run("system_profiler", "SPUSBDataType", "-json"); err == nil {
		if serial, ok := scanSystemProfiler(out); ok {
			return serial, nil
		}
	}
	out, err := run("ioreg", "-p", "IOUSB", "-l")
	if err != nil {
		return "", fmt.Errorf("system_profiler and ioreg both failed: %v", err)
	}
	return scanIoreg(out)
}

// readSerialLinux walks /sys/bus/usb/devices; requires no external tools.
func readSerialLinux() (string, error) {
	entries, err := os.ReadDir("/sys/bus/usb/devices")
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		dir := "/sys/bus/usb/devices/" + entry.Name()
		vendor, errV := os.ReadFile(dir + "/idVendor")
		product, errP := os.ReadFile(dir + "/idProduct")
		if errV != nil || errP != nil {
			continue
		}
		if strings.TrimSpace(strings.ToLower(string(vendor))) == vid &&
			strings.TrimSpace(strings.ToLower(string(product))) == pid {
			serial, err := os.ReadFile(dir + "/serial")
			if err != nil {
				return "", fmt.Errorf("found LUPIN at %s but cannot read serial: %v", dir, err)
			}
			return string(serial), nil
		}
	}
	return "", fmt.Errorf("LUPIN (VID %s, PID %s) not found in /sys/bus/usb/devices", vid, pid)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func run(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.WaitDelay = 5 * time.Second
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("%s %v failed: %v", name, args, err)
	}
	return string(out), nil
}

var trailingHex = regexp.MustCompile(`(?i)([0-9a-f]{24,})\s*$`)

func extractTrailingHex(text string) (string, error) {
	m := trailingHex.FindStringSubmatch(strings.TrimSpace(text))
	if m == nil {
		return "", fmt.Errorf("no hex serial in device id: %q", text)
	}
	return m[1], nil
}

// scanSystemProfiler extracts the serial from `system_profiler -json` output
// without a full JSON schema: look for a block containing the VID/PID pair.
func scanSystemProfiler(output string) (string, bool) {
	lower := strings.ToLower(output)
	for _, marker := range []string{`"vendor_id" : "0x` + vid, `"vendor_id":"0x` + vid} {
		start := 0
		for {
			i := strings.Index(lower[start:], marker)
			if i < 0 {
				break
			}
			block := output[start+i:]
			if strings.Contains(block, `0x`+pid) {
				if serial, ok := findJSONString(block, "serial_num"); ok {
					return serial, true
				}
			}
			start += i + len(marker)
		}
	}
	return "", false
}

// scanIoreg finds "USB Serial Number" = "<hex>" in the LUPIN ioreg block.
func scanIoreg(output string) (string, error) {
	for _, block := range strings.Split(output, `"LUPIN `) {
		if !strings.Contains(strings.ToLower(block), vid) {
			continue
		}
		re := regexp.MustCompile(`"USB Serial Number"\s*=\s*"([^"]+)"`)
		if m := re.FindStringSubmatch(block); m != nil {
			return m[1], nil
		}
	}
	return "", fmt.Errorf("no LUPIN USB serial in ioreg output")
}

func findJSONString(block, key string) (string, bool) {
	re := regexp.MustCompile(`"` + key + `"\s*:\s*"([^"]*)"`)
	if m := re.FindStringSubmatch(block); m != nil && m[1] != "" {
		return m[1], true
	}
	return "", false
}

func normalizeHex(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func hexDecode(s string) ([]byte, error) {
	if len(s)%2 != 0 {
		return nil, fmt.Errorf("odd hex length")
	}
	out := make([]byte, len(s)/2)
	for i := 0; i < len(out); i++ {
		v, err := strconv.ParseUint(s[i*2:i*2+2], 16, 8)
		if err != nil {
			return nil, err
		}
		out[i] = byte(v)
	}
	return out, nil
}

func round6(v float64) float64 {
	const scale = 1e6
	if v >= 0 {
		return float64(int64(v*scale+0.5)) / scale
	}
	return float64(int64(v*scale-0.5)) / scale
}
