import urllib.request
import re
try:
    from bs4 import BeautifulSoup
except:
    pass

url1 = "https://flag.dol.gov/performance"
try:
    req = urllib.request.Request(url1, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read()
    soup = BeautifulSoup(html, 'html.parser')
    for a in soup.find_all('a', href=True):
        if 'LCA' in a['href'] or 'H-1B' in a.get_text() or 'DisclosureData' in a['href']:
            print("PERFORMANCE LINK:", a['href'], a.get_text())
except Exception as e:
    print("Error parsing performance:", e)

url2 = "https://flag.dol.gov/wage-data/wage-search"
try:
    req = urllib.request.Request(url2, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read()
    soup = BeautifulSoup(html, 'html.parser')
    for a in soup.find_all('a', href=True):
        if 'wage' in a['href'].lower() or 'oes' in a['href'].lower() or 'excel' in a['href'].lower() or 'xls' in a['href'].lower() or 'xlsx' in a['href'].lower():
            print("WAGE LINK:", a['href'], a.get_text())
except Exception as e:
    print("Error parsing wage:", e)
