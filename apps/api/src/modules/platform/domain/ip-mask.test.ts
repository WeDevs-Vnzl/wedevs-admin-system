import { describe, expect, it } from 'vitest';
import { IP_MASK, maskIp } from './ip-mask';

// Port of the FE `maskIp` cases (fe/src/features/activity/components/activity-detail-sheet.test.tsx).
describe('maskIp', () => {
  it('keeps the first three IPv4 octets and masks the last one', () => {
    expect(maskIp('192.0.2.14')).toBe('192.0.2.•••');
    expect(maskIp('198.51.100.7')).toBe('198.51.100.•••');
  });

  it('masks everything after the third group of an IPv6 address and passes nothing through', () => {
    expect(maskIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3:•••');
    expect(maskIp(null)).toBeNull();
  });

  it('returns null for an absent or empty address', () => {
    expect(maskIp('')).toBeNull();
    expect(maskIp(undefined)).toBeNull();
  });

  it('masks a compressed IPv6 address after its known leading groups, never echoing the tail', () => {
    expect(maskIp('2001:db8::1')).toBe('2001:db8:•••');
    expect(maskIp('fe80::1')).toBe('fe80:•••');
    expect(maskIp('1:2:3:4::5')).toBe('1:2:3:•••');
    expect(maskIp('fe80::')).toBe('fe80:•••');
  });

  it('masks an address with no known leading group entirely', () => {
    expect(maskIp('::1')).toBe(IP_MASK);
    expect(maskIp('::')).toBe(IP_MASK);
  });

  it('reads an IPv4-mapped IPv6 address (dual-stack sockets) as IPv4', () => {
    expect(maskIp('::ffff:192.0.2.14')).toBe('192.0.2.•••');
  });

  it('answers the mask alone for anything else, without echoing the text', () => {
    expect(maskIp('garbage')).toBe('•••');
    expect(maskIp('999.1.1.1')).toBe('•••');
    expect(maskIp('192.0.2')).toBe('•••');
    expect(maskIp('192.0.2.14 ')).toBe('•••');
    expect(maskIp('a:b')).toBe('•••');
    expect(maskIp('1:2:3:4:5:6:7:8:9')).toBe('•••');
    expect(maskIp('1::2::3')).toBe('•••');
    expect(maskIp('::ffff:999.1.1.1')).toBe('•••');
    expect(maskIp('gggg::1')).toBe('•••');
  });
});
