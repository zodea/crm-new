from __future__ import annotations

import argparse
import html
import re
from dataclasses import dataclass
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    Flowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "docs" / "guides" / "project-start-and-schedule.md"
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "瑞航CRM_新项目启动与施工排程使用指南.pdf"

FONT_REGULAR = Path("C:/Windows/Fonts/msyh.ttc")
FONT_BOLD = Path("C:/Windows/Fonts/msyhbd.ttc")

INK = colors.HexColor("#172033")
INK_SOFT = colors.HexColor("#526075")
INK_FAINT = colors.HexColor("#7C889A")
BRAND = colors.HexColor("#2F73C9")
BRAND_DEEP = colors.HexColor("#1E5698")
BRAND_SOFT = colors.HexColor("#EAF3FF")
LINE = colors.HexColor("#D9E1EC")
SURFACE = colors.HexColor("#F5F7FA")
SUCCESS = colors.HexColor("#16845B")
SUCCESS_SOFT = colors.HexColor("#E9F7F0")
WARNING = colors.HexColor("#A86108")
WARNING_SOFT = colors.HexColor("#FFF4DE")
PURPLE = colors.HexColor("#6F4CC3")
PURPLE_SOFT = colors.HexColor("#F2EDFF")


@dataclass(frozen=True)
class GuideMeta:
    title: str
    subtitle: str
    version: str
    date: str
    status: str


@dataclass(frozen=True)
class FlowStep:
    status: str
    title: str
    description: str


def register_fonts() -> None:
    if not FONT_REGULAR.exists() or not FONT_BOLD.exists():
        raise FileNotFoundError("未找到微软雅黑字体，无法可靠生成中文 PDF")
    pdfmetrics.registerFont(TTFont("RuihangSans", str(FONT_REGULAR)))
    pdfmetrics.registerFont(TTFont("RuihangSansBold", str(FONT_BOLD)))
    pdfmetrics.registerFontFamily(
        "RuihangSans",
        normal="RuihangSans",
        bold="RuihangSansBold",
        italic="RuihangSans",
        boldItalic="RuihangSansBold",
    )


def parse_front_matter(source: str) -> tuple[GuideMeta, str]:
    if not source.startswith("---\n"):
        raise ValueError("指南缺少 YAML 风格的文档元信息")
    end = source.find("\n---\n", 4)
    if end < 0:
        raise ValueError("指南文档元信息未闭合")
    values: dict[str, str] = {}
    for line in source[4:end].splitlines():
        key, separator, value = line.partition(":")
        if separator:
            values[key.strip()] = value.strip()
    required = ("title", "subtitle", "version", "date", "status")
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise ValueError(f"指南文档元信息缺少：{', '.join(missing)}")
    return (
        GuideMeta(
            title=values["title"],
            subtitle=values["subtitle"],
            version=values["version"],
            date=values["date"],
            status=values["status"],
        ),
        source[end + 5 :],
    )


def inline_markup(text: str) -> str:
    escaped = html.escape(text.strip())
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`(.+?)`", r'<font name="RuihangSans">\1</font>', escaped)
    escaped = re.sub(
        r"\[(.+?)\]\((.+?)\)",
        r'<link href="\2" color="#1E5698">\1</link>',
        escaped,
    )
    return escaped


def make_styles() -> dict[str, ParagraphStyle]:
    samples = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "Body",
            parent=samples["BodyText"],
            fontName="RuihangSans",
            fontSize=9.4,
            leading=15.5,
            textColor=INK,
            spaceAfter=5,
            allowWidows=0,
            allowOrphans=0,
        ),
        "h2": ParagraphStyle(
            "Heading2",
            parent=samples["Heading2"],
            fontName="RuihangSansBold",
            fontSize=17,
            leading=24,
            textColor=INK,
            spaceBefore=4,
            spaceAfter=10,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "Heading3",
            parent=samples["Heading3"],
            fontName="RuihangSansBold",
            fontSize=12.2,
            leading=18,
            textColor=BRAND_DEEP,
            spaceBefore=8,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=samples["BodyText"],
            fontName="RuihangSans",
            fontSize=9.3,
            leading=15,
            leftIndent=14,
            firstLineIndent=-8,
            bulletIndent=3,
            textColor=INK,
            spaceAfter=3,
        ),
        "number": ParagraphStyle(
            "Number",
            parent=samples["BodyText"],
            fontName="RuihangSans",
            fontSize=9.3,
            leading=15,
            leftIndent=18,
            firstLineIndent=-13,
            bulletIndent=0,
            textColor=INK,
            spaceAfter=3,
        ),
        "quote": ParagraphStyle(
            "Quote",
            parent=samples["BodyText"],
            fontName="RuihangSans",
            fontSize=8.9,
            leading=14.5,
            textColor=INK,
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=samples["BodyText"],
            fontName="RuihangSansBold",
            fontSize=8.2,
            leading=12.5,
            textColor=INK,
            alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=samples["BodyText"],
            fontName="RuihangSans",
            fontSize=8.1,
            leading=12.5,
            textColor=INK,
            alignment=TA_LEFT,
        ),
        "code": ParagraphStyle(
            "Code",
            parent=samples["BodyText"],
            fontName="RuihangSans",
            fontSize=8.2,
            leading=13.2,
            textColor=INK,
        ),
    }


class FlowDiagram(Flowable):
    def __init__(self, steps: list[FlowStep], styles: dict[str, ParagraphStyle]):
        super().__init__()
        self.steps = steps
        self.styles = styles
        self.step_height = 58
        self.width = 0
        self.height = len(steps) * self.step_height + 4

    def wrap(self, available_width: float, available_height: float) -> tuple[float, float]:
        self.width = available_width
        return available_width, self.height

    @staticmethod
    def tone(status: str) -> tuple[colors.Color, colors.Color]:
        if "当前已可用" in status:
            return SUCCESS, SUCCESS_SOFT
        if "待开发" in status or "未闭环" in status:
            return WARNING, WARNING_SOFT
        if status.startswith("步骤"):
            return BRAND, BRAND_SOFT
        return PURPLE, PURPLE_SOFT

    def draw(self) -> None:
        canvas = self.canv
        circle_x = 15
        box_x = 38
        box_width = self.width - box_x

        for index, step in enumerate(self.steps):
            top = self.height - index * self.step_height
            center_y = top - 27
            tone, soft = self.tone(step.status)

            if index < len(self.steps) - 1:
                canvas.setStrokeColor(LINE)
                canvas.setLineWidth(1.2)
                canvas.line(circle_x, center_y - 13, circle_x, center_y - self.step_height + 13)

            canvas.setFillColor(tone)
            canvas.circle(circle_x, center_y, 11, stroke=0, fill=1)
            canvas.setFont("RuihangSansBold", 8.3)
            canvas.setFillColor(colors.white)
            canvas.drawCentredString(circle_x, center_y - 3, str(index + 1))

            canvas.setFillColor(soft)
            canvas.setStrokeColor(LINE)
            canvas.roundRect(box_x, center_y - 22, box_width, 44, 5, stroke=1, fill=1)

            status_width = min(
                88,
                pdfmetrics.stringWidth(step.status, "RuihangSans", 7.2) + 12,
            )
            canvas.setFillColor(tone)
            canvas.roundRect(
                box_x + box_width - status_width - 8,
                center_y + 4,
                status_width,
                14,
                4,
                stroke=0,
                fill=1,
            )
            canvas.setFillColor(colors.white)
            canvas.setFont("RuihangSans", 7.2)
            canvas.drawCentredString(
                box_x + box_width - status_width / 2 - 8,
                center_y + 8,
                step.status,
            )

            title = Paragraph(
                f"<b>{inline_markup(step.title)}</b>",
                ParagraphStyle(
                    "FlowTitle",
                    parent=self.styles["body"],
                    fontName="RuihangSansBold",
                    fontSize=9.5,
                    leading=12,
                    textColor=INK,
                ),
            )
            title.wrapOn(canvas, box_width - status_width - 26, 15)
            title.drawOn(canvas, box_x + 10, center_y + 4)

            description = Paragraph(
                inline_markup(step.description),
                ParagraphStyle(
                    "FlowDescription",
                    parent=self.styles["body"],
                    fontName="RuihangSans",
                    fontSize=7.8,
                    leading=10,
                    textColor=INK_SOFT,
                ),
            )
            description.wrapOn(canvas, box_width - 20, 20)
            description.drawOn(canvas, box_x + 10, center_y - 17)


def parse_table(lines: list[str], styles: dict[str, ParagraphStyle], width: float) -> Table:
    rows: list[list[str]] = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        rows.append(cells)
    if len(rows) > 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in rows[1]):
        rows.pop(1)
    column_count = max(len(row) for row in rows)
    for row in rows:
        row.extend([""] * (column_count - len(row)))

    data: list[list[Paragraph]] = []
    for row_index, row in enumerate(rows):
        style = styles["table_header"] if row_index == 0 else styles["table_cell"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])

    width_ratios = {
        2: [0.29, 0.71],
        3: [0.24, 0.48, 0.28],
        4: [0.21, 0.34, 0.27, 0.18],
    }.get(column_count, [1 / column_count] * column_count)
    table = Table(
        data,
        colWidths=[width * ratio for ratio in width_ratios],
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BRAND_SOFT),
                ("TEXTCOLOR", (0, 0), (-1, 0), INK),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SURFACE]),
            ],
        ),
    )
    return table


def callout(text: str, styles: dict[str, ParagraphStyle], width: float) -> Table:
    table = Table(
        [[Paragraph(inline_markup(text), styles["quote"])]],
        colWidths=[width],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BRAND_SOFT),
                ("LINEBEFORE", (0, 0), (0, -1), 3, BRAND),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ],
        ),
    )
    return table


def code_block(lines: list[str], styles: dict[str, ParagraphStyle], width: float) -> Table:
    content = "<br/>".join(html.escape(line).replace(" ", "&#160;") for line in lines)
    table = Table([[Paragraph(content, styles["code"])]], colWidths=[width])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ],
        ),
    )
    return table


def markdown_story(
    body: str,
    styles: dict[str, ParagraphStyle],
    content_width: float,
) -> list[Flowable]:
    story: list[Flowable] = []
    lines = body.splitlines()
    index = 0
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph_lines
        if paragraph_lines:
            text = " ".join(line.strip() for line in paragraph_lines)
            story.append(Paragraph(inline_markup(text), styles["body"]))
            paragraph_lines = []

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if not stripped:
            flush_paragraph()
            index += 1
            continue

        if stripped == "<!-- pagebreak -->":
            flush_paragraph()
            story.append(PageBreak())
            index += 1
            continue

        if stripped == ":::flow":
            flush_paragraph()
            index += 1
            steps: list[FlowStep] = []
            while index < len(lines) and lines[index].strip() != ":::":
                parts = [part.strip() for part in lines[index].split("|", 2)]
                if len(parts) == 3:
                    steps.append(FlowStep(*parts))
                index += 1
            if not steps:
                raise ValueError("发现空的 flow 块")
            story.append(FlowDiagram(steps, styles))
            story.append(Spacer(1, 7))
            index += 1
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            index += 1
            block_lines: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                block_lines.append(lines[index])
                index += 1
            story.append(code_block(block_lines, styles, content_width))
            story.append(Spacer(1, 6))
            index += 1
            continue

        if stripped.startswith("|"):
            flush_paragraph()
            table_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index])
                index += 1
            story.append(parse_table(table_lines, styles, content_width))
            story.append(Spacer(1, 8))
            continue

        if stripped.startswith("## "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[3:]), styles["h2"]))
            index += 1
            continue

        if stripped.startswith("### "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[4:]), styles["h3"]))
            index += 1
            continue

        if stripped.startswith("> "):
            flush_paragraph()
            quote_lines = [stripped[2:]]
            index += 1
            while index < len(lines) and lines[index].strip().startswith("> "):
                quote_lines.append(lines[index].strip()[2:])
                index += 1
            story.append(callout(" ".join(quote_lines), styles, content_width))
            story.append(Spacer(1, 7))
            continue

        if stripped.startswith("- "):
            flush_paragraph()
            story.append(
                Paragraph(inline_markup(stripped[2:]), styles["bullet"], bulletText="-"),
            )
            index += 1
            continue

        number_match = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if number_match:
            flush_paragraph()
            story.append(
                Paragraph(
                    inline_markup(number_match.group(2)),
                    styles["number"],
                    bulletText=f"{number_match.group(1)}.",
                ),
            )
            index += 1
            continue

        paragraph_lines.append(line)
        index += 1

    flush_paragraph()
    return story


def cover_story(meta: GuideMeta) -> list[Flowable]:
    title_style = ParagraphStyle(
        "CoverTitle",
        fontName="RuihangSansBold",
        fontSize=27,
        leading=38,
        textColor=INK,
        alignment=TA_LEFT,
    )
    subtitle_style = ParagraphStyle(
        "CoverSubtitle",
        fontName="RuihangSans",
        fontSize=12,
        leading=20,
        textColor=INK_SOFT,
        alignment=TA_LEFT,
    )
    eyebrow_style = ParagraphStyle(
        "CoverEyebrow",
        fontName="RuihangSansBold",
        fontSize=9,
        leading=13,
        textColor=BRAND,
        spaceAfter=12,
    )
    meta_style = ParagraphStyle(
        "CoverMeta",
        fontName="RuihangSans",
        fontSize=9,
        leading=14,
        textColor=INK_SOFT,
        alignment=TA_CENTER,
    )

    metadata = Table(
        [
            [
                Paragraph(f"<b>版本</b><br/>{html.escape(meta.version)}", meta_style),
                Paragraph(f"<b>日期</b><br/>{html.escape(meta.date)}", meta_style),
                Paragraph(f"<b>性质</b><br/>{html.escape(meta.status)}", meta_style),
            ],
        ],
        colWidths=[51 * mm, 51 * mm, 51 * mm],
    )
    metadata.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ],
        ),
    )

    return [
        Spacer(1, 37 * mm),
        Paragraph("瑞航 CRM · 工程财务管理", eyebrow_style),
        Paragraph(html.escape(meta.title), title_style),
        Spacer(1, 8 * mm),
        Paragraph(html.escape(meta.subtitle), subtitle_style),
        Spacer(1, 18 * mm),
        metadata,
        Spacer(1, 28 * mm),
        Paragraph(
            "本指南只说明当前已经实现且可操作的流程；未完成能力不写成已上线功能。",
            ParagraphStyle(
                "CoverNote",
                fontName="RuihangSans",
                fontSize=9,
                leading=15,
                textColor=INK_FAINT,
            ),
        ),
        PageBreak(),
    ]


def draw_cover(canvas, meta: GuideMeta) -> None:
    canvas.saveState()
    canvas.setAuthor("瑞航 CRM")
    canvas.setFillColor(BRAND)
    canvas.rect(0, A4[1] - 7 * mm, A4[0], 7 * mm, stroke=0, fill=1)
    canvas.setStrokeColor(LINE)
    canvas.line(27 * mm, 18 * mm, A4[0] - 27 * mm, 18 * mm)
    canvas.setFont("RuihangSans", 8)
    canvas.setFillColor(INK_FAINT)
    canvas.drawString(27 * mm, 11 * mm, "瑞航 CRM")
    canvas.drawRightString(A4[0] - 27 * mm, 11 * mm, meta.title)
    canvas.restoreState()


def draw_page(canvas, page_number: int, meta: GuideMeta) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.white)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.setFont("RuihangSans", 7.6)
    canvas.setFillColor(colors.black)
    canvas.setFillColor(INK_FAINT)
    canvas.line(22 * mm, 15 * mm, A4[0] - 22 * mm, 15 * mm)
    canvas.drawString(22 * mm, 9.5 * mm, meta.title)
    canvas.drawRightString(A4[0] - 22 * mm, 9.5 * mm, f"第 {page_number} 页")
    canvas.restoreState()


class GuideCanvas(pdf_canvas.Canvas):
    """在正文之后绘制页眉页脚，避免分页内容遮挡页面装饰。"""

    def __init__(self, *args, guide_meta: GuideMeta, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._guide_meta = guide_meta
        self._saved_page_states: list[dict] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        for state in self._saved_page_states:
            self.__dict__.update(state)
            if self._pageNumber == 1:
                draw_cover(self, self._guide_meta)
            else:
                draw_page(self, self._pageNumber - 1, self._guide_meta)
            pdf_canvas.Canvas.showPage(self)
        pdf_canvas.Canvas.save(self)


def build_pdf(source_path: Path, output_path: Path) -> None:
    register_fonts()
    meta, body = parse_front_matter(source_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    document = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=22 * mm,
        leftMargin=22 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=meta.title,
        author="瑞航 CRM",
        subject=meta.subtitle,
    )
    styles = make_styles()
    content_width = A4[0] - document.leftMargin - document.rightMargin
    story: list[Flowable] = cover_story(meta)
    story.extend(markdown_story(body, styles, content_width))
    def canvas_maker(*args, **kwargs):
        return GuideCanvas(*args, guide_meta=meta, **kwargs)

    document.build(story, canvasmaker=canvas_maker)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成瑞航 CRM 新项目使用指南 PDF")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    build_pdf(args.source.resolve(), args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
