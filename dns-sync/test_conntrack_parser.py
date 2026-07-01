"""Quick parser checks: python3 test_conntrack_parser.py"""

from conntrack_parser import parse_conntrack_line

SAMPLE_TCP = (
    "ipv4     2 tcp      6 431969 ESTABLISHED "
    "src=10.0.0.12 dst=140.82.112.26 sport=54682 dport=443 "
    "src=140.82.112.26 dst=172.31.23.239 sport=443 dport=54682 [ASSURED] mark=0 use=1"
)

SAMPLE_UDP_DNS = (
    "ipv4     2 udp      17 10 src=10.0.0.12 dst=10.0.0.1 sport=48048 dport=53 "
    "src=10.0.0.1 dst=10.0.0.12 sport=53 dport=48048 mark=0 use=1"
)


def test_tcp_outbound():
    flow = parse_conntrack_line(SAMPLE_TCP, vpn_cidr="10.0.0.0/24")
    assert flow is not None
    assert flow.client_ip == "10.0.0.12"
    assert flow.protocol == "tcp"
    assert flow.dest_ip == "140.82.112.26"
    assert flow.dest_port == 443


def test_udp_to_gateway_dns_filtered():
    assert parse_conntrack_line(SAMPLE_UDP_DNS, vpn_cidr="10.0.0.0/24") is None


if __name__ == "__main__":
    test_tcp_outbound()
    test_udp_to_gateway_dns_filtered()
    print("ok")
