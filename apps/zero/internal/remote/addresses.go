package remote

import (
	"net"
	"slices"
	"strings"
)

// maxCandidates bounds the addresses a connection string lists. Each one
// lengthens the string, and more rarely help.
const maxCandidates = 4

// routeAddresses lie outside every local network (documentation ranges); a UDP
// socket "connected" to one makes the kernel pick the default route's
// interface. Nothing is sent.
var routeAddresses = []string{"192.0.2.1:9", "[2001:db8::1]:9"}

// virtualInterfaces are interface name prefixes that only this machine's
// containers and VMs can reach.
var virtualInterfaces = []string{"docker", "br-", "veth", "virbr", "vnet", "cni", "flannel", "podman", "vmnet", "lxc", "lxd"}

// Interface is one network interface's up, non-loopback addresses.
type Interface struct {
	Name      string
	Addresses []net.IP
}

// tailnetRanges are the addresses Tailscale assigns: a tailnet address reaches
// this machine from any of the user's devices, on any network.
var tailnetRanges = []*net.IPNet{mustCIDR("100.64.0.0/10"), mustCIDR("fd7a:115c:a1e0::/48")}

func mustCIDR(text string) *net.IPNet {
	_, network, err := net.ParseCIDR(text)
	if err != nil {
		panic(err)
	}
	return network
}

func tailnetAddress(ip net.IP) bool {
	return slices.ContainsFunc(tailnetRanges, func(network *net.IPNet) bool { return network.Contains(ip) })
}

// Candidates lists the addresses a client might reach this machine at, best
// first: the server side of the SSH connection the user is in (they reached
// this machine there), tailnet addresses, the default route's address, then
// the rest of the interfaces, IPv4 before IPv6. sshConnection is
// $SSH_CONNECTION: "client_ip client_port server_ip server_port".
func Candidates(sshConnection string, route net.IP, interfaces []Interface) []string {
	var found []string
	add := func(ip net.IP) {
		if !usableAddress(ip) || len(found) == maxCandidates {
			return
		}
		if text := ip.String(); !slices.Contains(found, text) {
			found = append(found, text)
		}
	}
	if fields := strings.Fields(sshConnection); len(fields) == 4 {
		add(net.ParseIP(fields[2]))
	}
	var tailnet4, tailnet6, v4, v6 []net.IP
	for _, candidate := range interfaces {
		if virtualInterface(candidate.Name) {
			continue
		}
		for _, ip := range candidate.Addresses {
			switch {
			case tailnetAddress(ip) && ip.To4() != nil:
				tailnet4 = append(tailnet4, ip)
			case tailnetAddress(ip):
				tailnet6 = append(tailnet6, ip)
			case ip.To4() != nil:
				v4 = append(v4, ip)
			default:
				v6 = append(v6, ip)
			}
		}
	}
	for _, ip := range append(tailnet4, tailnet6...) {
		add(ip)
	}
	add(route)
	for _, ip := range append(v4, v6...) {
		add(ip)
	}
	return found
}

func virtualInterface(name string) bool {
	return slices.ContainsFunc(virtualInterfaces, func(prefix string) bool { return strings.HasPrefix(name, prefix) })
}

// usableAddress reports whether ip can be dialed from another machine without
// a zone.
func usableAddress(ip net.IP) bool {
	return ip != nil && !ip.IsLoopback() && !ip.IsUnspecified() && !ip.IsLinkLocalUnicast() && !ip.IsMulticast()
}

// RouteAddress is the local address of the default route, or nil.
func RouteAddress() net.IP {
	for _, address := range routeAddresses {
		conn, err := net.Dial("udp", address)
		if err != nil {
			continue
		}
		local, ok := conn.LocalAddr().(*net.UDPAddr)
		_ = conn.Close()
		if ok && usableAddress(local.IP) {
			return local.IP
		}
	}
	return nil
}

// Interfaces reads this machine's up, non-loopback interfaces.
func Interfaces() []Interface {
	system, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var result []Interface
	for _, candidate := range system {
		if candidate.Flags&net.FlagUp == 0 || candidate.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := candidate.Addrs()
		if err != nil {
			continue
		}
		item := Interface{Name: candidate.Name}
		for _, address := range addresses {
			if network, ok := address.(*net.IPNet); ok {
				item.Addresses = append(item.Addresses, network.IP)
			}
		}
		result = append(result, item)
	}
	return result
}
