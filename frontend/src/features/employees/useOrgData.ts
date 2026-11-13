import { employeesApi } from '../../api/employees';
import type { Department, Position } from '../../api/types';
import { useAsync } from '../../hooks/useAsync';

/** Departamentos y puestos del tenant (GET /departments y GET /positions, todos los roles). */
export function useOrgData() {
  return useAsync<{ departments: Department[]; positions: Position[] }>(async (signal) => {
    const [deps, pos] = await Promise.all([employeesApi.listDepartments(signal), employeesApi.listPositions(undefined, signal)]);
    return { departments: deps.items, positions: pos.items };
  }, []);
}
