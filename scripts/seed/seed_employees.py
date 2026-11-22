"""employees: departamentos, puestos y empleados en la base hcm_employees (schema tenant_<id>)."""
from context import bootstrap, to_json  # primero: agrega shared/python al path
from common import db_pg

BATCH = 1000


def department_rows(company):
    return [{"id": d.id, "name": d.name} for d in company.departments]


def position_rows(company, dept_ids: dict):
    return [{"id": p.id, "title": p.title, "department_id": dept_ids[d.name],
             "min_salary": p.min_salary, "max_salary": p.max_salary}
            for d in company.departments for p in d.positions]


def employee_rows(company, dept_ids: dict, position_ids: dict):
    rows = []
    for person in company.people:
        manager = company.manager_of(person)
        rows.append({
            "id": person.id,
            "first_name": person.first_name,
            "last_name": person.last_name,
            "email": person.email,
            "document_number": person.document_number,
            "phone": person.phone,
            "hire_date": person.hire_date,
            "termination_date": person.termination_date,
            "status": person.status,
            "salary": person.salary,
            "department_id": dept_ids[person.department.name],
            "position_id": position_ids[(person.department.name, person.position.title)],
            "manager_id": manager.id if manager else None,
        })
    return rows


def _ensure_departments(conn, company) -> dict:
    """Inserta los departamentos y devuelve nombre -> id real (reusa los que ya existían)."""
    conn.run("""
        INSERT INTO departments (id, name)
        SELECT id, name FROM jsonb_to_recordset(CAST(:rows AS JSONB)) AS x(id UUID, name TEXT)
        ON CONFLICT DO NOTHING
        """, rows=to_json(department_rows(company)))
    names = [d.name for d in company.departments]
    found = db_pg.query(conn, "SELECT id, name FROM departments WHERE name = ANY(CAST(:names AS TEXT[]))",
                        names=names)
    return {row["name"]: str(row["id"]) for row in found}


def _ensure_positions(conn, company, dept_ids: dict) -> dict:
    """Inserta los puestos y devuelve (departamento, título) -> id real."""
    conn.run("""
        INSERT INTO positions (id, title, department_id, min_salary, max_salary)
        SELECT id, title, department_id, min_salary, max_salary
        FROM jsonb_to_recordset(CAST(:rows AS JSONB))
             AS x(id UUID, title TEXT, department_id UUID, min_salary NUMERIC, max_salary NUMERIC)
        ON CONFLICT DO NOTHING
        """, rows=to_json(position_rows(company, dept_ids)))
    found = db_pg.query(conn, """
        SELECT p.id, p.title, d.name AS department
        FROM positions p JOIN departments d ON d.id = p.department_id
        WHERE d.id = ANY(CAST(:ids AS UUID[]))
        """, ids=list(dept_ids.values()))
    return {(row["department"], row["title"]): str(row["id"]) for row in found}


INSERT_EMPLOYEES = """
    INSERT INTO employees (id, first_name, last_name, email, document_number, phone, hire_date,
                           termination_date, status, salary, department_id, position_id, manager_id)
    SELECT id, first_name, last_name, email, document_number, phone, hire_date,
           termination_date, status, salary, department_id, position_id, manager_id
    FROM jsonb_to_recordset(CAST(:rows AS JSONB)) AS x(
        id UUID, first_name TEXT, last_name TEXT, email TEXT, document_number TEXT, phone TEXT,
        hire_date DATE, termination_date DATE, status TEXT, salary NUMERIC,
        department_id UUID, position_id UUID, manager_id UUID)
    ON CONFLICT DO NOTHING
"""


def seed(ctx, company) -> int:
    tenant = company.tenant
    db_pg.create_tenant_schema(tenant, bootstrap.migration_sql("employees"), db_name=ctx.employees_db)
    with db_pg.with_tenant(tenant, db_name=ctx.employees_db) as conn:
        dept_ids = _ensure_departments(conn, company)
        position_ids = _ensure_positions(conn, company, dept_ids)
    rows = employee_rows(company, dept_ids, position_ids)
    # Los jefes van primero: el resto los referencia con manager_id.
    rows.sort(key=lambda row: row["manager_id"] is not None)
    for start in range(0, len(rows), BATCH):
        with db_pg.with_tenant(tenant, db_name=ctx.employees_db) as conn:
            conn.run(INSERT_EMPLOYEES, rows=to_json(rows[start:start + BATCH]))
    return len(rows) + len(dept_ids) + len(position_ids)
