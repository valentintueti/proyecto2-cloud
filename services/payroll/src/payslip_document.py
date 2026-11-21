"""A one-page PDF payslip using the standard PDF fonts."""

from src.calculator import PayslipAmounts


def _pdf_text(text: str) -> bytes:
    encoded = text.encode("cp1252", errors="replace")
    return (encoded.replace(b"\\", b"\\\\").replace(b"(", b"\\(")
            .replace(b")", b"\\)").replace(b"\r", b" ").replace(b"\n", b" "))


def render_payslip(company: str, employee: str, period: str, amounts: PayslipAmounts) -> bytes:
    rows = [
        "Boleta de pago",
        f"Empresa: {company}",
        f"Empleado: {employee}",
        f"Período: {period}",
        f"Bruto: S/ {amounts.gross:.2f}",
        f"Descuento ONP: S/ {amounts.pension_deduction:.2f}",
        f"Descuento por permisos personales: S/ {amounts.leave_deduction:.2f}",
        f"Neto: S/ {amounts.net:.2f}",
    ]
    stream = b"BT /F1 12 Tf 52 778 Td 26 TL\n"
    stream += b" T*\n".join(b"(" + _pdf_text(row) + b") Tj" for row in rows)
    stream += b"\nET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(b"%d 0 obj\n" % index + obj + b"\nendobj\n")

    xref = len(pdf)
    count = len(objects) + 1
    pdf.extend(b"xref\n0 %d\n0000000000 65535 f \n" % count)
    for offset in offsets:
        pdf.extend(b"%010d 00000 n \n" % offset)
    pdf.extend(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (count, xref))
    return bytes(pdf)
