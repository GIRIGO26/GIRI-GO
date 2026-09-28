# builds tests/sample_ai.pdf – a typical 3-page work instruction (header, chapters, figures, warnings, change log)
# used to test the AI PDF import:  python3 tests/make_sample_pdf.py [--small]
import sys
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm

small = '--small' in sys.argv
def scene(fn, bg, obj, label):
    im = Image.new('RGB', (900, 600), bg); d = ImageDraw.Draw(im)
    for i in range(0, 900, 45): d.line([(i, 0), (i, 600)], fill=tuple(max(0, c - 18) for c in bg))
    obj(d); d.rectangle([0, 560, 900, 600], fill=(30, 30, 30)); d.text((14, 570), label, fill=(220, 220, 220))
    if small: im = im.resize((300, 200))
    im.save(fn, quality=30 if small else 88)
scene('pdf_img1.jpg', (120, 130, 140), lambda d: (d.rectangle([250, 150, 650, 450], fill=(60, 60, 70), outline=(20, 20, 20), width=6), d.ellipse([400, 250, 500, 350], fill=(200, 200, 210))), 'Spannvorrichtung SV-12')
scene('pdf_img2.jpg', (150, 140, 120), lambda d: [d.ellipse([200 + i * 140, 250, 260 + i * 140, 310], fill=(40, 40, 40)) for i in range(4)], 'Schrauben M6 x 20')
scene('pdf_img3.jpg', (110, 120, 150), lambda d: (d.rectangle([150, 280, 750, 320], fill=(200, 40, 40)), d.polygon([(700, 240), (780, 300), (700, 360)], fill=(200, 40, 40))), 'Drehmomentschluessel 10 Nm')
scene('pdf_img4.jpg', (130, 150, 130), lambda d: (d.rectangle([200, 200, 700, 420], outline=(10, 10, 10), width=8), d.line([(200, 310), (700, 310)], fill=(255, 210, 0), width=4)), 'Spaltmass pruefen')

W, H = A4
out = 'sample_ai_small.pdf' if small else 'sample_ai.pdf'
c = canvas.Canvas(out, pagesize=A4, pageCompression=1)
def header(p):
    c.setFillColorRGB(0, .3, .68); c.rect(0, H - 22 * mm, W, 22 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1); c.setFont('Helvetica-Bold', 14); c.drawString(15 * mm, H - 14 * mm, 'Musterwerk GmbH  |  Arbeitsanweisung AA-0457')
    c.setFont('Helvetica', 8); c.drawRightString(W - 15 * mm, H - 14 * mm, f'Rev. C  |  Seite {p} von 3')
    c.setFillColorRGB(.4, .4, .4); c.setFont('Helvetica', 7); c.drawString(15 * mm, 10 * mm, 'Erstellt: M. Huber  |  Freigegeben: QS 12.03.2026')
def para(y, txt, size=10, bold=False):
    c.setFillColorRGB(0, 0, 0); c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    for line in txt.split('\n'): c.drawString(15 * mm, y, line); y -= size * 1.45
    return y
def warn(y, txt):
    c.setFillColorRGB(1, .93, .6); c.rect(15 * mm, y - 9 * mm, W - 30 * mm, 11 * mm, fill=1, stroke=0)
    c.setFillColorRGB(.55, .3, 0); c.setFont('Helvetica-Bold', 9); c.drawString(18 * mm, y - 4.5 * mm, 'ACHTUNG: ' + txt); return y - 15 * mm
def cap(x, y, t): c.setFillColorRGB(0, 0, 0); c.setFont('Helvetica-Oblique', 8); c.drawString(x, y, t)

header(1); y = H - 35 * mm
y = para(y, 'Spannvorrichtung SV-12 ruesten', 18, True) - 4
y = para(y, 'Geltungsbereich: Linie 3, Station 4. Werkzeug: Drehmomentschluessel 5-25 Nm.\nPSA: Schutzhandschuhe, Schutzbrille.', 9) - 8
y = para(y, '1  Vorbereitung', 13, True) - 2
y = para(y, '1.1  Werkstueck in die Spannvorrichtung einlegen. Anschlag links, Kante buendig.', 10)
c.drawImage('pdf_img1.jpg', 15 * mm, y - 80 * mm, 120 * mm, 80 * mm); y -= 86 * mm
cap(15 * mm, y, 'Abb. 1: Werkstueck in SV-12'); y -= 10 * mm
y = para(y, '1.2  Spannhebel schliessen, bis er hoerbar einrastet.', 10)
y = warn(y - 2, 'Quetschgefahr - Finger nicht zwischen Hebel und Anschlag!')
c.showPage()
header(2); y = H - 35 * mm
y = para(y, '2  Montage', 13, True) - 2
y = para(y, '2.1  Vier Schrauben M6 x 20 (Teilenr. 400-2211) einsetzen und handfest vorziehen.\n       Reihenfolge ueber Kreuz: 1 - 3 - 2 - 4.', 10)
c.drawImage('pdf_img2.jpg', 15 * mm, y - 70 * mm, 105 * mm, 70 * mm); y -= 76 * mm
cap(15 * mm, y, 'Abb. 2: Schraubenpositionen'); y -= 10 * mm
y = para(y, '2.2  Schrauben mit dem Drehmomentschluessel auf 10 Nm anziehen.', 10)
c.drawImage('pdf_img3.jpg', 90 * mm, y - 60 * mm, 95 * mm, 63 * mm); y -= 66 * mm
cap(90 * mm, y, 'Abb. 3: Drehmomentschluessel einstellen'); y -= 8 * mm
y = warn(y, 'Drehmoment nicht ueberschreiten - Gewinde im Gehaeuse ist Aluminium.')
c.showPage()
header(3); y = H - 35 * mm
y = para(y, '3  Pruefung', 13, True) - 2
y = para(y, '3.1  Spaltmass zwischen Deckel und Gehaeuse pruefen: max. 0,5 mm (Fuehlerlehre).', 10)
c.drawImage('pdf_img4.jpg', 15 * mm, y - 75 * mm, 112 * mm, 75 * mm); y -= 81 * mm
cap(15 * mm, y, 'Abb. 4: Spaltmass'); y -= 10 * mm
y = para(y, '3.2  Pruefergebnis im Laufzettel eintragen und Teil auf Ablage B legen.', 10) - 10
y = para(y, 'Aenderungshistorie', 11, True)
y = para(y, 'Rev. A  01.02.2025  Ersterstellung\nRev. B  10.09.2025  Drehmoment von 12 auf 10 Nm geaendert', 8)
c.save()
import os; print(out, os.path.getsize(out))
