"""Regenerate tiny, synthetic PDF fixtures (reportlab, pypdf, Pillow)."""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

ROOT = Path(__file__).parent


def finish(canvas, output, name, password=None):
    canvas.save()
    writer = PdfWriter(clone_from=PdfReader(BytesIO(output.getvalue())))
    writer.root_object[NameObject("/Lang")] = TextStringObject("fr")
    if password:
        writer.encrypt(password, owner_password="owner-secret", algorithm="RC4-128")
    writer.write(ROOT / name)


output = BytesIO()
canvas = Canvas(output, pagesize=(612, 792), invariant=1)
canvas.setTitle("Un document simple")
# Deliberately paint the last paragraph first to exercise geometric ordering.
canvas.setFont("Helvetica", 12)
canvas.drawString(60, 630, "Le second paragraphe reste bien distinct.")
canvas.setFont("Helvetica-Bold", 16)
canvas.drawString(60, 720, "Une lecture simple")
canvas.setFont("Helvetica", 12)
canvas.drawString(60, 684, "Voici la première ligne du document.")
canvas.drawString(60, 669, "La deuxième ligne poursuit le même paragraphe.")
finish(canvas, output, "simple.pdf")

output = BytesIO()
canvas = Canvas(output, pagesize=(612, 792), invariant=1)
canvas.setTitle("Trois pages dans le bon ordre")
for number, label in enumerate(["Première", "Deuxième", "Troisième"], 1):
    canvas.setFont("Helvetica", 10)
    canvas.drawString(60, 770, "Bulletin Orateur")
    canvas.drawString(60, 28, "Document de démonstration")
    canvas.setFont("Helvetica", 12)
    canvas.drawString(60, 710, f"{label} page : contenu numéro {number}.")
    canvas.drawString(60, 694, "La suite de ce paragraphe se lit après la première ligne.")
    canvas.drawString(60, 640, "Cette phrase du corps doit rester sur chaque page.")
    canvas.showPage()
finish(canvas, output, "multipage.pdf")

output = BytesIO()
canvas = Canvas(output, pagesize=(612, 792), invariant=1)
canvas.drawString(60, 720, "Un contenu protégé par mot de passe.")
finish(canvas, output, "protected.pdf", password="secret")

writer = PdfWriter(clone_from=PdfReader(ROOT / "simple.pdf"))
writer.encrypt("", owner_password="owner-secret", permissions_flag=0, algorithm="RC4-128")
writer.write(ROOT / "restricted.pdf")

output = BytesIO()
canvas = Canvas(output, pagesize=(612, 792), invariant=1)
image = Image.new("RGB", (800, 200), "white")
ImageDraw.Draw(image).text((30, 50), "Texte dans une image, sans couche texte PDF.", fill="black")
canvas.drawImage(ImageReader(image), 60, 580, width=480, height=120)
finish(canvas, output, "image-only.pdf")
