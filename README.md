# michealrayberry.com — deploy package

Static site for the Public Accountability Project. One self-contained page
(index.html) + robots.txt + sitemap.xml. Data is live from Google Sheets /
Apps Script / YouTube / Drive — deploying this folder is the whole site.

## Deploy (Netlify)
1. https://app.netlify.com/drop — drag this whole folder in (first time), or
   push these files to the GitHub repo (michealrayberry/a) and connect the
   repo in Netlify for auto-deploys.
2. Site settings → Domain management → add michealrayberry.com.
   Netlify shows the DNS records to set at GoDaddy (A/ALIAS or nameservers).
3. HTTPS is automatic once DNS resolves.

## Updating the site
Replace index.html with the newest bundle and redeploy (drag again, or push).

Administered by the Accountability Partner (§13).
