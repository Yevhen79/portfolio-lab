"""One-shot fix: ensure the Libertex 'Coca–Cola' (en-dash) symbol maps to KO."""
from pathlib import Path

p = Path(__file__).parent / "build_seed_from_scrape.py"
text = p.read_text(encoding="utf-8")

# Show what's currently there
for line in text.splitlines():
    if "Coca" in line:
        print(repr(line))

# Make sure both variants point to KO
en_dash_key = "Coca–Cola"
hyphen_key = "Coca-Cola"

# Replace any garbled key with proper en-dash literal
import re
patched = re.sub(
    r'"Coca[^"A-Za-z]+Cola"\s*:\s*\("KO",[^)]+\)',
    f'"{en_dash_key}":     ("KO", "Coca-Cola Co.", "USD")',
    text,
)
# Ensure the plain hyphen version is also present (idempotent)
if f'"{hyphen_key}"' not in patched:
    patched = patched.replace(
        f'"{en_dash_key}":     ("KO", "Coca-Cola Co.", "USD"),',
        (f'"{en_dash_key}":     ("KO", "Coca-Cola Co.", "USD"),\n'
         f'    "{hyphen_key}":          ("KO", "Coca-Cola Co.", "USD"),'),
    )

p.write_text(patched, encoding="utf-8")
print("\n--- After patch ---")
for line in patched.splitlines():
    if "Coca" in line:
        print(repr(line))
