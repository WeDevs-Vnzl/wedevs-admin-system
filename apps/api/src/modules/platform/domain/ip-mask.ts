/**
 * Masks the client address of an activity entry before it leaves the BE (PRD §8.14, DT-114, Q-BE2-5).
 * Port of the FE `maskIp` rule: an IPv4 address keeps its first three octets (`192.0.2.•••`); an IPv6
 * address keeps its first three groups (`2001:db8:85a3:•••`); anything else becomes the mask alone, so no
 * unrecognized text is echoed. Pure: no I/O, no framework.
 *
 * Two deliberate refinements of the FE rule, both to avoid leaking the address through the mask:
 * - a compressed IPv6 address (`fe80::1`) keeps only the groups known positionally, before `::`; the FE
 *   rule would print `fe80::1:•••`, which is the whole address;
 * - an IPv4-mapped IPv6 address (`::ffff:192.0.2.14`, what dual-stack sockets report) is masked as IPv4.
 */

export const IP_MASK = '•••';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

function isIpv4(value: string): boolean {
  const match = IPV4.exec(value);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
}

function groupsOf(part: string): string[] {
  return part === '' ? [] : part.split(':');
}

function maskIpv4(value: string): string {
  return `${value.split('.').slice(0, 3).join('.')}.${IP_MASK}`;
}

function maskIpv6(value: string): string {
  const halves = value.split('::');
  if (halves.length > 2) return IP_MASK;
  const [head = '', tail = ''] = halves;
  const compressed = halves.length === 2;
  const known = groupsOf(head);
  const rest = compressed ? groupsOf(tail) : [];
  const groups = compressed ? [...known, ...rest] : known;

  if (!groups.every((group) => HEX_GROUP.test(group))) return IP_MASK;
  if (!compressed && groups.length !== 8) return IP_MASK;
  if (compressed && groups.length > 7) return IP_MASK;
  // Only the groups before `::` have a known position; with none, nothing may be shown.
  if (compressed && known.length === 0) return IP_MASK;
  return `${known.slice(0, 3).join(':')}:${IP_MASK}`;
}

export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const mapped = IPV4_MAPPED.exec(ip);
  const candidate = mapped?.[1] ?? ip;
  if (isIpv4(candidate)) return maskIpv4(candidate);
  if (ip.includes(':')) return maskIpv6(ip);
  return IP_MASK;
}
