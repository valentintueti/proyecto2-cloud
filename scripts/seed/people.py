"""Datos base de cada tenant, siempre iguales para el mismo tenant y tamaño.

Todos los seeds parten de aquí, así que un empleado tiene el mismo id, email, sueldo y jefe en
employees, identity, payroll, time_leave y notifications.
"""
import random
import uuid
import zlib
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from functools import lru_cache

from faker import Faker

NAMESPACE = uuid.UUID("3b0a4f6e-9c2d-4e1b-8f7a-5d6c2b1e0a99")
TODAY = date.today()
DEMO_USERS = 20          # empleado1..empleado20 siempre activos y con datos en todos los módulos

DEPARTMENTS = [
    ("Tecnología", [("Desarrollador", 4500, 9000), ("Analista de Datos", 4000, 8000),
                    ("Arquitecto Cloud", 8000, 14000), ("Soporte TI", 2500, 4500)]),
    ("Recursos Humanos", [("Analista de RRHH", 3000, 5500), ("Reclutador", 2800, 5000),
                          ("Especialista en Planillas", 3200, 6000), ("Asistente de RRHH", 1800, 3000)]),
    ("Finanzas", [("Contador", 3500, 6500), ("Analista Financiero", 4000, 7500),
                  ("Tesorero", 5000, 9000), ("Asistente Contable", 1800, 3200)]),
    ("Ventas", [("Ejecutivo de Ventas", 2500, 6000), ("Key Account Manager", 5000, 10000),
                ("Asistente Comercial", 1600, 2800), ("Analista Comercial", 3000, 5500)]),
    ("Marketing", [("Analista de Marketing", 3000, 5500), ("Diseñador Gráfico", 2500, 5000),
                   ("Community Manager", 2200, 4000), ("Especialista SEO", 3000, 5800)]),
    ("Operaciones", [("Coordinador de Operaciones", 3500, 6500), ("Supervisor de Planta", 3800, 7000),
                     ("Operario", 1300, 2200), ("Planificador", 3200, 6000)]),
    ("Logística", [("Jefe de Almacén", 3500, 6000), ("Asistente de Logística", 1600, 2800),
                   ("Analista de Compras", 3000, 5500), ("Despachador", 1400, 2400)]),
    ("Legal", [("Abogado Corporativo", 6000, 11000), ("Asistente Legal", 2000, 3500),
               ("Especialista en Cumplimiento", 4500, 8000), ("Paralegal", 2200, 3800)]),
    ("Atención al Cliente", [("Agente de Servicio", 1500, 2600), ("Supervisor de Servicio", 3000, 5000),
                             ("Analista de Calidad", 2800, 4800), ("Especialista Postventa", 2400, 4200)]),
    ("Administración", [("Asistente Administrativo", 1600, 2800), ("Jefe Administrativo", 4500, 8000),
                        ("Recepcionista", 1300, 2100), ("Analista de Procesos", 3500, 6500)]),
]
LEAVE_TYPES = ["VACATION"] * 6 + ["SICK"] * 2 + ["PERSONAL"] * 2
LEAVE_STATUSES = ["APPROVED"] * 12 + ["PENDING"] * 5 + ["REJECTED"] * 2 + ["CANCELLED"]


def stable_id(tenant: str, *parts) -> str:
    """UUID determinístico: volver a correr el seed produce los mismos ids (sin duplicar)."""
    return str(uuid.uuid5(NAMESPACE, ":".join([tenant, *map(str, parts)])))


def rng(tenant: str, purpose: str) -> random.Random:
    return random.Random(zlib.crc32(f"{tenant}:{purpose}".encode()))


def utc_iso(day: date, hour: int = 9, minute: int = 0) -> str:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc).isoformat()


def business_days(start: date, end: date) -> int:
    return sum(1 for n in range((end - start).days + 1) if (start + timedelta(days=n)).weekday() < 5)


def admin_email(tenant: str) -> str:
    return f"admin@{tenant}.com"


@dataclass(frozen=True)
class Position:
    id: str
    title: str
    department_id: str
    min_salary: int
    max_salary: int


@dataclass(frozen=True)
class Department:
    id: str
    name: str
    positions: tuple


@dataclass(frozen=True)
class Person:
    n: int
    id: str
    first_name: str
    last_name: str
    email: str
    document_number: str
    phone: str
    hire_date: date
    termination_date: date | None
    salary: Decimal
    department: Department
    position: Position
    manager_n: int | None          # None si es jefe de departamento
    role: str                      # MANAGER o EMPLOYEE

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    @property
    def status(self) -> str:
        return "TERMINATED" if self.termination_date else "ACTIVE"

    def employed_on(self, day: date) -> bool:
        return self.hire_date <= day and (self.termination_date is None or self.termination_date >= day)


@dataclass(frozen=True)
class LeaveRequest:
    id: str
    person: Person
    type: str
    start: date
    end: date
    days: int
    status: str
    decided_by: str | None
    created_at: str


@dataclass
class Company:
    tenant: str
    size: int
    departments: list = field(default_factory=list)
    people: list = field(default_factory=list)
    leaves: list = field(default_factory=list)

    def person(self, n: int) -> Person:
        return self.people[n - 1]

    def manager_of(self, person: Person) -> Person | None:
        return self.person(person.manager_n) if person.manager_n else None


def _departments(tenant: str) -> list:
    result = []
    for name, positions in DEPARTMENTS:
        dept_id = stable_id(tenant, "department", name)
        result.append(Department(dept_id, name, tuple(
            Position(stable_id(tenant, "position", name, title), title, dept_id, lo, hi)
            for title, lo, hi in positions)))
    return result


def _people(tenant: str, size: int, departments: list) -> list:
    fake = Faker("es_MX")
    fake.seed_instance(zlib.crc32(f"{tenant}:people".encode()))
    r = rng(tenant, "people")
    people = []
    for n in range(1, size + 1):
        is_manager = n <= len(departments)          # empleado1..10: jefe de cada departamento
        dept = departments[(n - 1) % len(departments)]
        position = dept.positions[0 if is_manager else r.randrange(len(dept.positions))]
        hire = TODAY - timedelta(days=r.randint(60, 8 * 365))
        terminated = None
        if n > DEMO_USERS and not is_manager and r.random() < 0.03:
            terminated = min(TODAY - timedelta(days=1), hire + timedelta(days=r.randint(30, 900)))
        salary_steps = (position.max_salary - position.min_salary) // 50
        salary = Decimal(position.min_salary + 50 * r.randint(0, salary_steps)).quantize(Decimal("0.01"))
        people.append(Person(
            n=n,
            id=stable_id(tenant, "employee", n),
            first_name=fake.first_name()[:80],
            last_name=f"{fake.last_name()} {fake.last_name()}"[:80],
            email=f"empleado{n}@{tenant}.com",
            document_number=str(10_000_000 + n),
            phone=f"+51 9{r.randint(10, 99)} {r.randint(100, 999)} {r.randint(100, 999)}",
            hire_date=hire,
            termination_date=terminated,
            salary=salary,
            department=dept,
            position=position,
            manager_n=None if is_manager else departments.index(dept) + 1,
            role="MANAGER" if is_manager else "EMPLOYEE",
        ))
    return people


def _leaves(tenant: str, people: list, count: int, company_managers) -> list:
    r = rng(tenant, "leaves")
    leaves = []
    for i in range(count):
        person = people[i % len(people)]
        start = TODAY - timedelta(days=r.randint(-60, 300))   # pasadas y futuras
        while start.weekday() >= 5:
            start += timedelta(days=1)
        end = start + timedelta(days=r.randint(0, 9))
        status = LEAVE_STATUSES[r.randrange(len(LEAVE_STATUSES))]
        manager = company_managers(person)
        decider = manager.email if manager else admin_email(tenant)
        leaves.append(LeaveRequest(
            id=stable_id(tenant, "leave", i),
            person=person,
            type=LEAVE_TYPES[r.randrange(len(LEAVE_TYPES))],
            start=start,
            end=end,
            days=business_days(start, end),
            status=status,
            decided_by=decider if status in ("APPROVED", "REJECTED") else None,
            created_at=utc_iso(start - timedelta(days=r.randint(3, 20)), 14),
        ))
    return leaves


@lru_cache(maxsize=8)
def company(tenant: str, size: int) -> Company:
    """Empresa completa de un tenant con `size` empleados (10 000 por defecto en el seed)."""
    if size < len(DEPARTMENTS) + DEMO_USERS:
        raise ValueError(f"size debe ser al menos {len(DEPARTMENTS) + DEMO_USERS}")
    result = Company(tenant, size)
    result.departments = _departments(tenant)
    result.people = _people(tenant, size, result.departments)
    leave_count = max(1, size // 10)
    result.leaves = _leaves(tenant, result.people, leave_count, result.manager_of)
    return result
