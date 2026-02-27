import pandas as pd
import json
import math
import sys
import os

def normalize_soc(soc_str):
    s = str(soc_str).strip()
    if pd.isna(s) or s == 'nan':
        return s
    if len(s) == 7 and s[2] == '-':  # e.g. 15-1252
        return s + ".00"
    return s

def clean_val(val_str):
    if pd.isna(val_str):
        return None
    val_str = str(val_str).strip().replace('$', '').replace(',', '').lower()
    if val_str in ['*', '#', 'na', 'n/a', '', 'nan']:
         return None
    try:
         return float(val_str)
    except:
         return None

print("Loading LCA data...")
lca = pd.read_excel('lca.xlsx', engine='openpyxl')

if 'SOC_CODE' not in lca.columns:
    print("Cannot find SOC_CODE in LCA. Columns are:", lca.columns)
    sys.exit(1)

lca['SOC_CODE_NORM'] = lca['SOC_CODE'].apply(normalize_soc)
lca['SOC_TITLE'] = lca['SOC_TITLE'].astype(str).str.strip().str.title()

print("Extracting Top 150 SOC codes...")
counts = lca.groupby('SOC_CODE_NORM').size().sort_values(ascending=False)
top_soc_codes = counts.head(150).index.tolist()

soc_mapping = {}
for code in top_soc_codes:
    title = lca[lca['SOC_CODE_NORM'] == code]['SOC_TITLE'].iloc[0]
    if title == 'Nan':
        title = code
    soc_mapping[code] = title

print("Loading Geography data...")
geo_df = pd.read_csv('wage_dir/OFLC_Wages_2025-26_Updated/Geography.csv', dtype=str)
# Some areas have multiple rows for different counties, we just take the first for AreaName
geo_df = geo_df.drop_duplicates(subset=['Area'])
area_mapping = dict(zip(geo_df['Area'].str.strip(), geo_df['AreaName'].str.strip()))

print("Loading Wage Data...")
wage_df = pd.read_csv('wage_dir/OFLC_Wages_2025-26_Updated/ALC_Export.csv', dtype=str)
wage_df['SocCodeNorm'] = wage_df['SocCode'].apply(normalize_soc)

wage_matrix = {}
valid_areas = set()

dropped_rows = 0
violations = 0
filtered_wage = wage_df[wage_df['SocCodeNorm'].isin(top_soc_codes)]

for idx, row in filtered_wage.iterrows():
    soc = row['SocCodeNorm']
    area = str(row['Area']).strip()
    
    l1 = clean_val(row['Level1'])
    l2 = clean_val(row['Level2'])
    l3 = clean_val(row['Level3'])
    l4 = clean_val(row['Level4'])
    
    if l1 is None or l2 is None or l3 is None or l4 is None:
        dropped_rows += 1
        continue
        
    if l1 <= 0 or l2 <= 0 or l3 <= 0 or l4 <= 0:
        dropped_rows += 1
        continue
        
    if l4 < 1000:
        l1 *= 2080
        l2 *= 2080
        l3 *= 2080
        l4 *= 2080
        
    l1 = int(math.floor(l1))
    l2 = int(math.floor(l2))
    l3 = int(math.floor(l3))
    l4 = int(math.floor(l4))
    
    if not (l1 <= l2 <= l3 <= l4):
        violations += 1
        continue
        
    if soc not in wage_matrix:
        wage_matrix[soc] = {}
        
    wage_matrix[soc][area] = [l1, l2, l3, l4]
    valid_areas.add(area)

print(f"Dropped {dropped_rows} rows due to invalid/missing parsing.")
print(f"Violations (L1 <= L2 <= L3 <= L4): {violations}")

final_soc_codes = [{"code": k, "label": soc_mapping.get(k, k)} for k in sorted(wage_matrix.keys())]

final_areas = []
for area in sorted(list(valid_areas)):
    final_areas.append({"code": area, "label": area_mapping.get(area, str(area))})

# Validation checks
row_count = sum(len(areas) for areas in wage_matrix.values())
print(f"Row count of SOC+Area combinations: {row_count}")

def check(soc, area, threshold):
    val = wage_matrix.get(soc, {}).get(area)
    if not val:
        print(f"MISSING: {soc} in {area}")
        return
    if val[3] >= threshold:
        print(f"OK: {soc} in {area} L4 = {val[3]} >= {threshold}")
    else:
        print(f"WRONG: {soc} in {area} L4 = {val[3]} < {threshold}")

check('15-1252.00', '41940', 200000)
check('15-1252.00', '35620', 160000)
check('15-1211.00', '41940', 160000)

five_digit = sum(1 for a in valid_areas if len(a) == 5)
seven_digit = sum(1 for a in valid_areas if len(a) == 7)
other = len(valid_areas) - five_digit - seven_digit

print(f"Area code diversity: 5-digit: {five_digit}, 7-digit: {seven_digit}, other: {other}")

# EXPORT
out_data = {
  "metadata": {
    "source": "July 2025–June 2026 OFLC FLC Wage Library",
    "geo_delineation": "May 2024 OEWS (2020 Census)"
  },
  "soc_codes": final_soc_codes,
  "areas": final_areas,
  "wage_matrix": wage_matrix
}

os.makedirs('/Users/k.far.88/wagelevel/data', exist_ok=True)
out_path = '/Users/k.far.88/wagelevel/data/wage_data.json'
with open(out_path, 'w') as f:
    json.dump(out_data, f, separators=(',', ':'))

size = os.path.getsize(out_path)
print(f"Final file size: {size / 1024 / 1024:.2f} MB")
