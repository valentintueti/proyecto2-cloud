import { describe, expect, it } from 'vitest';
import { allowedTransitions } from '../api/recruitment';
import { addDays, businessDays, todayISO } from './format';
import { isDate, isEmail, isPhone, money, TENANT_ID } from './validation';

describe('allowedTransitions (recruitment)', () => {
  it('avance lineal y rechazo desde cualquier etapa abierta', () => {
    expect(allowedTransitions('APPLIED')).toEqual(['SCREENING', 'REJECTED']);
    expect(allowedTransitions('SCREENING')).toEqual(['INTERVIEW', 'REJECTED']);
    expect(allowedTransitions('INTERVIEW')).toEqual(['OFFER', 'REJECTED']);
    expect(allowedTransitions('OFFER')).toEqual(['HIRED', 'REJECTED']);
  });

  it('HIRED y REJECTED son finales', () => {
    expect(allowedTransitions('HIRED')).toEqual([]);
    expect(allowedTransitions('REJECTED')).toEqual([]);
  });
});

describe('businessDays (igual que time_leave.business_days)', () => {
  it('cuenta lunes a viernes, ambos extremos incluidos', () => {
    expect(businessDays('2026-11-09', '2026-11-13')).toBe(5); // lun-vie
    expect(businessDays('2026-11-09', '2026-11-15')).toBe(5); // incluye fin de semana
    expect(businessDays('2026-11-14', '2026-11-15')).toBe(0); // sáb-dom
    expect(businessDays('2026-11-13', '2026-11-09')).toBe(0); // rango invertido
  });
});

describe('fechas', () => {
  it('addDays cruza meses y años', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('todayISO usa la zona horaria de Lima', () => {
    // 2026-01-01 03:00 UTC = 2025-12-31 22:00 en Lima (UTC-5)
    expect(todayISO(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31');
  });
});

describe('validaciones', () => {
  it('tenantId como en common.tenant', () => {
    expect(TENANT_ID.test('acme')).toBe(true);
    expect(TENANT_ID.test('acme_2')).toBe(true);
    expect(TENANT_ID.test('Acme')).toBe(false);
    expect(TENANT_ID.test('1acme')).toBe(false);
    expect(TENANT_ID.test('a')).toBe(false);
  });

  it('email, fecha, teléfono y montos', () => {
    expect(isEmail('ana@acme.com')).toBe(true);
    expect(isEmail('ana@acme')).toBe(false);
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isPhone('+51 987 654 321')).toBe(true);
    expect(isPhone('12')).toBe(false);
    expect(money('100.50', 'Salario')).toBeUndefined();
    expect(money('-1', 'Salario')).toMatch(/entre 0/);
    expect(money('', 'Salario', { optional: true })).toBeUndefined();
  });
});
