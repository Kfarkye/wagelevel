import pandas as pd
import requests

lca_url = 'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2025_Q4.xlsx'
wage_url = 'https://flag.dol.gov/sites/default/files/wages/OFLC_Wages_2025-26.zip'

import os
if not os.path.exists('lca.xlsx'):
    print("Downloading lca.xlsx...")
    # It's large, stream it
    response = requests.get(lca_url, stream=True)
    with open('lca.xlsx', 'wb') as f:
        for chunk in response.iter_content(chunk_size=1024*1024):
            f.write(chunk)
    print("lca.xlsx downloaded.")

if not os.path.exists('wage.zip'):
    print("Downloading wage.zip...")
    response = requests.get(wage_url, stream=True)
    with open('wage.zip', 'wb') as f:
        for chunk in response.iter_content(chunk_size=1024*1024):
            f.write(chunk)
    from zipfile import ZipFile
    with ZipFile('wage.zip', 'r') as zipObj:
        zipObj.extractall('wage_dir')
    print("wage extracted.")

print("Inspecting LCA...")
df = pd.read_excel('lca.xlsx', nrows=15)
print(df.head(15))
