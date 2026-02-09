# Stress CSV Fixtures

Use `generate_stress_csv.py` to create large CSV files for UI performance testing.

Default output:
- `stress_single_header_5000_rows_300_cols.csv`
- `stress_double_header_5000_rows_300_cols.csv`
- `stress_single_header_25000_rows_300_cols.csv`
- `stress_double_header_25000_rows_300_cols.csv`

Run:

```bash
python3 tests/data/generate_stress_csv.py
```

Optional custom sizes:

```bash
python3 tests/data/generate_stress_csv.py --rows 5000 25000 --columns 300
```
