#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
from pathlib import Path

DEFAULT_COLUMN_COUNT = 300
DEFAULT_ROW_COUNTS = (5000, 25000)


def generate_stress_csv(
    output_path: Path,
    row_count: int,
    column_count: int = DEFAULT_COLUMN_COUNT,
    *,
    double_header: bool = False,
    overwrite: bool = True,
) -> Path:
    """Write a deterministic stress CSV fixture to disk."""
    if row_count < 1:
        raise ValueError("row_count must be >= 1")
    if column_count < 1:
        raise ValueError("column_count must be >= 1")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and not overwrite:
        return output_path

    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)

        if double_header:
            top_header, second_header = build_double_header_rows(column_count)
            writer.writerow(top_header)
            writer.writerow(second_header)
        else:
            writer.writerow(build_single_header(column_count))

        for row_index in range(1, row_count + 1):
            writer.writerow(build_data_row(row_index, column_count))

    return output_path


def generate_stress_fixture_set(
    output_dir: Path = Path("tests/data"),
    row_counts: tuple[int, ...] = DEFAULT_ROW_COUNTS,
    column_count: int = DEFAULT_COLUMN_COUNT,
    *,
    overwrite: bool = True,
) -> list[Path]:
    """Generate single/double-header stress files for each requested row count."""
    output_dir = Path(output_dir)
    written: list[Path] = []

    for row_count in row_counts:
        written.append(
            generate_stress_csv(
                output_dir / f"stress_single_header_{row_count}_rows_{column_count}_cols.csv",
                row_count=row_count,
                column_count=column_count,
                double_header=False,
                overwrite=overwrite,
            )
        )
        written.append(
            generate_stress_csv(
                output_dir / f"stress_double_header_{row_count}_rows_{column_count}_cols.csv",
                row_count=row_count,
                column_count=column_count,
                double_header=True,
                overwrite=overwrite,
            )
        )

    return written


def build_single_header(column_count: int) -> list[str]:
    return [f"col_{index:03d}" for index in range(1, column_count + 1)]


def build_double_header_rows(column_count: int, group_size: int = 10) -> tuple[list[str], list[str]]:
    top_header: list[str] = []
    second_header: list[str] = []

    for col_index in range(column_count):
        one_based = col_index + 1
        group_index = col_index // group_size + 1

        # Sparse top row mirrors "double header row" layouts where group labels
        # appear once and rely on fill-forward semantics for remaining columns.
        top_header.append(f"group_{group_index:02d}" if col_index % group_size == 0 else "")
        second_header.append(f"metric_{one_based:03d}")

    return top_header, second_header


def build_data_row(row_index: int, column_count: int) -> list[str]:
    row: list[str] = []
    for col_index in range(column_count):
        one_based = col_index + 1
        if one_based % 37 == 0:
            row.append(f"id_{row_index:05d}_{one_based:03d}")
        elif one_based % 13 == 0:
            value = ((row_index * one_based) % 100_000) / 10.0
            row.append(f"{value:.1f}")
        else:
            value = (row_index * 97 + one_based * 31) % 1_000_000
            row.append(str(value))
    return row


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate large CSV fixtures for table-performance stress testing."
    )
    parser.add_argument(
        "--output-dir",
        default="tests/data",
        help="Directory where generated CSV files are written (default: tests/data).",
    )
    parser.add_argument(
        "--rows",
        type=int,
        nargs="+",
        default=list(DEFAULT_ROW_COUNTS),
        help="One or more data row counts (default: 5000 25000).",
    )
    parser.add_argument(
        "--columns",
        type=int,
        default=DEFAULT_COLUMN_COUNT,
        help="Number of columns to generate (default: 300).",
    )
    parser.add_argument(
        "--no-overwrite",
        action="store_true",
        help="Skip writing files that already exist.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    written = generate_stress_fixture_set(
        output_dir=Path(args.output_dir),
        row_counts=tuple(args.rows),
        column_count=args.columns,
        overwrite=not args.no_overwrite,
    )

    for path in written:
        size_mb = path.stat().st_size / (1024 * 1024)
        print(f"{path} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
