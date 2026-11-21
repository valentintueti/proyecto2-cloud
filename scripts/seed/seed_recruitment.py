"""recruitment: vacantes (2 %) y postulaciones (98 %) en la tabla de recruitment."""
import zlib
from datetime import timedelta

from faker import Faker

from context import write_items
from people import TODAY, admin_email, rng, stable_id, utc_iso

LOCATIONS = ["Lima", "Arequipa", "Trujillo", "Cusco", "Piura", "Remoto", "Híbrido - Lima"]
STAGES = ["APPLIED"] * 8 + ["SCREENING"] * 5 + ["INTERVIEW"] * 3 + ["OFFER"] + ["REJECTED"] * 3


def items(company):
    tenant, pk = company.tenant, f"TENANT#{company.tenant}"
    r = rng(tenant, "recruitment")
    fake = Faker("es_MX")
    fake.seed_instance(zlib.crc32(f"{tenant}:candidates".encode()))

    job_count = max(1, company.size // 50)
    jobs = []
    for j in range(job_count):
        dept = company.departments[j % len(company.departments)]
        position = dept.positions[r.randrange(len(dept.positions))]
        created = TODAY - timedelta(days=r.randint(5, 180))
        job = {
            "PK": pk,
            "SK": f"JOB#{stable_id(tenant, 'job', j)}",
            "tenantId": tenant,
            "jobId": stable_id(tenant, "job", j),
            "title": position.title,
            "departmentId": dept.id,
            "description": f"Buscamos {position.title} para el área de {dept.name}.",
            "location": LOCATIONS[r.randrange(len(LOCATIONS))],
            "openings": r.randint(1, 5),
            "status": "OPEN" if r.random() < 0.8 else "CLOSED",
            "createdBy": admin_email(tenant),
            "createdAt": utc_iso(created, 15),
            "updatedAt": utc_iso(created, 15),
        }
        jobs.append((job, created))
        yield job

    for i in range(company.size - job_count):
        job, job_created = jobs[i % job_count]
        created = min(TODAY, job_created + timedelta(days=r.randint(0, 30)))
        application_id = stable_id(tenant, "application", i)
        yield {
            "PK": pk,
            "SK": f"APP#{job['jobId']}#{application_id}",
            "tenantId": tenant,
            "applicationId": application_id,
            "jobId": job["jobId"],
            "firstName": fake.first_name()[:100],
            "lastName": fake.last_name()[:100],
            "email": f"candidato{i + 1}@correo-{tenant}.com",
            "phone": f"+51 9{r.randint(10, 99)} {r.randint(100, 999)} {r.randint(100, 999)}",
            "stage": STAGES[r.randrange(len(STAGES))],
            "cvKey": None,
            "notes": "",
            "createdAt": utc_iso(created, 16),
            "updatedAt": utc_iso(created, 16),
        }


def seed(ctx, company) -> int:
    return write_items(ctx.table("recruitment"), items(company))
