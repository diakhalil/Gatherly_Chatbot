import argparse
import os
from pathlib import Path

import pymupdf
from playwright.sync_api import sync_playwright


def find_browser():
    """Return an installed Chromium browser without downloading anything."""
    candidates = [
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    ]

    for browser in candidates:
        if browser.exists():
            return browser

    raise FileNotFoundError(
        "Microsoft Edge or Google Chrome was not found"
    )


def optimize_pdf(pdf_path):
    """Reduce image size while preserving selectable text and image objects."""
    optimized_path = pdf_path.with_suffix(".optimized.pdf")

    try:
        with pymupdf.open(pdf_path) as document:
            document.rewrite_images(
                dpi_threshold=180,
                dpi_target=144,
                quality=75,
            )
            document.save(
                optimized_path,
                garbage=4,
                clean=True,
                deflate=True,
                deflate_images=True,
                deflate_fonts=True,
            )

        os.replace(optimized_path, pdf_path)
    finally:
        optimized_path.unlink(missing_ok=True)


def load_all_images(page):
    """Trigger images that the saved webpage marked for lazy loading."""
    page.evaluate(
        """
        async () => {
            document.querySelectorAll("img").forEach((image) => {
                image.loading = "eager";
            });

            const step = Math.max(window.innerHeight, 800);

            for (
                let position = 0;
                position < document.documentElement.scrollHeight;
                position += step
            ) {
                window.scrollTo(0, position);
                await new Promise((resolve) => setTimeout(resolve, 20));
            }

            window.scrollTo(0, 0);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        """
    )


def convert_html_to_pdf(html_path, output_dir, overwrite=False):
    """Print the original saved HTML page to PDF without changing its layout."""
    html_path = html_path.resolve()
    output_path = output_dir / f"{html_path.stem}.pdf"
    temporary_path = output_dir / f".{html_path.stem}.temporary.pdf"

    if output_path.exists() and not overwrite:
        print(f"Skipping existing: {output_path.name}")
        return output_path

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=str(find_browser()),
                args=["--allow-file-access-from-files"],
            )

            page = browser.new_page()
            page.goto(
                html_path.as_uri(),
                wait_until="load",
                timeout=120_000,
            )
            load_all_images(page)

            page.pdf(
                path=str(temporary_path),
                format="A4",
                print_background=True,
                display_header_footer=False,
                prefer_css_page_size=True,
            )

            browser.close()

        optimize_pdf(temporary_path)
        os.replace(temporary_path, output_path)
        print(f"Created: {output_path}")
        return output_path
    finally:
        temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(
        description="Convert saved HTML pages to PDFs without changing layout."
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("docs/themes"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs/generated_pdfs"),
    )
    parser.add_argument(
        "--file",
        help="Convert only one HTML filename.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace previously generated PDFs.",
    )
    args = parser.parse_args()

    input_dir = args.input_dir.resolve()
    output_dir = args.output_dir.resolve()

    if not input_dir.is_dir():
        raise NotADirectoryError(
            f"Input directory not found: {input_dir}"
        )

    output_dir.mkdir(parents=True, exist_ok=True)

    if args.file:
        html_files = [input_dir / args.file]
    else:
        html_files = sorted(input_dir.glob("*.html"))

    if not html_files:
        raise FileNotFoundError(
            f"No HTML files found in: {input_dir}"
        )

    for html_file in html_files:
        if not html_file.is_file():
            raise FileNotFoundError(
                f"HTML file not found: {html_file}"
            )

        convert_html_to_pdf(
            html_file,
            output_dir,
            overwrite=args.overwrite,
        )


if __name__ == "__main__":
    main()
