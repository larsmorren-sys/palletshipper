# Palletshipper

React + Vite + Tailwind CSS met een Node.js/Express-backend. Een shipment bevat palletten en individuele objecten. Elk stuk heeft vier onafhankelijk aanpasbare transportstatussen met tijdstip. Meerdere stuks worden afzonderlijke objecten, ook als ze hetzelfde artikelnummer hebben.

Palletten kun je per 1 tot 200 tegelijk aanmaken. Ze krijgen automatisch `Pallet 1`, `Pallet 2`, enzovoort, vanaf het hoogste bestaande palletnummer binnen de shipment. Objecten krijgen een vast volgnummer per omschrijving binnen de shipment: `LED-scherm 1`, `LED-scherm 2`, enzovoort. De nummering loopt door bij volgende imports en manuele toevoegingen en blijft behouden bij palletwissels en herstarts. Bestaande objecten worden bij de eerste start van deze versie automatisch genummerd; hun tracking en pallettoewijzing blijven behouden.

## Lokaal starten

Gebruik Node.js 24.

```sh
npm install
npm run dev
```

Open de URL die Vite toont (standaard http://localhost:5173). De backend draait op poort 3001. De database en foto's worden in `data/` opgeslagen en blijven behouden na een herstart. De app vereist een netwerkverbinding; offline synchronisatie is niet geïmplementeerd.

## Login en gebruikersbeheer

Bij de eerste start verschijnt **Maak je beheerdersaccount**. Vul je eigen naam, e-mailadres en wachtwoord in (minstens 12 tekens). Je hebt ook een installatiecode nodig:

- Lokaal wordt die automatisch aangemaakt in `data/setup-token.txt`. Open dit bestand en kopieer de code naar het installatieformulier. De code verdwijnt uit dit bestand zodra het eerste account is aangemaakt.
- Op Railway stel je vóór de eerste start een lange willekeurige `SETUP_TOKEN` in via de servicevariabelen. Gebruik die waarde als installatiecode. Verwijder de variabele na de eerste installatie.

Er zijn geen standaardaccounts of standaardwachtwoorden. Zodra een beheerder bestaat, is de installatie gesloten. Er is geen openbare registratie.

Via **Gebruikersbeheer** kan een beheerder accounts aanmaken en naam, e-mailadres, rol, wachtwoord en actieve status wijzigen. Een nieuw wachtwoord, rolwijziging of gedeactiveerd account beëindigt bestaande sessies. Er blijft altijd minstens één actieve beheerder. Klik op je naam bovenaan om je eigen wachtwoord te wijzigen; andere sessies worden dan beëindigd. Accounts worden gedeactiveerd in plaats van verwijderd. E-mailuitnodigingen en herstel via e-mail zijn nog niet geïmplementeerd; een beheerder kan een wachtwoord opnieuw instellen.

### Toegang per shipment

- **Beheerder:** ziet en beheert alle shipments, ook bestaande shipments van vóór het loginsysteem.
- **Gebruiker:** ziet eigen shipments en shipments waarvoor toegang is toegekend. Kan daarin materiaal, palletten, foto's en tracking bijwerken.
- **Maker of beheerder:** stelt via **Shipmentinstellingen → Gebruikersrechten beheren** de gebruikers van een shipment in. De maker en beheerders behouden altijd toegang.

De API controleert de toegang ook voor individuele objecten, palletfoto's en wijzigingen. Gewone gebruikers krijgen geen automatische toegang tot oude shipments; een beheerder wijst deze toe. Foto's zijn alleen bereikbaar met een geldige sessie en toegang tot de shipment. Sessies blijven maximaal acht uur geldig en worden in SQLite opgeslagen. Wachtwoorden worden met een afzonderlijke salt en scrypt gehasht. Sessiecookies zijn HttpOnly en SameSite=Strict; in productie ook Secure. Verzoeken die gegevens wijzigen vereisen een CSRF-token.

### Trackingkolommen

Open **Trackingkolommen** boven de materiaallijst om **Out warehouse**, **In location**, **Out location** en **In warehouse** afzonderlijk te tonen of te verbergen. De keuze wordt per gebruiker en per shipment in de database bewaard, ook na uitloggen of een herstart. Verborgen statussen worden niet verwijderd. Dit is een persoonlijke weergavevoorkeur; gebruikers met shipmenttoegang behouden toegang tot de trackinggegevens.

### Objecten wijzigen en verwijderen

Boven de materiaallijst kun je sorteren op **Naam A–Z**, **Naam Z–A** of **Toevoegvolgorde**. De naamvolgorde houdt rekening met nummers: `Lamp 2` komt vóór `Lamp 10`. Zoeken werkt op naam, volgnummer, artikelnummer en opmerking, ook binnen de geselecteerde pallet. Hoofdletters en accenten maken geen verschil; meerdere zoekwoorden mogen in verschillende velden voorkomen. Wis de zoekopdracht met het kruisje om alle objecten van die weergave terug te tonen.

Gebruik **Bewerken** bij een object om omschrijving, artikelnummer, pallet en opmerking te wijzigen. Tracking blijft behouden. Het volgnummer blijft behouden tenzij dit nummer bij de nieuwe omschrijving al gebruikt is; in dat geval krijgt het object het volgende vrije nummer. Elk object is één afzonderlijk stuk; extra stuks voeg je via **Object toevoegen** toe.

**Verwijderen** vraagt een bevestiging en verwijdert het object inclusief zijn tracking definitief. De aantallen worden meteen bijgewerkt. Verwijderde nummers worden niet opnieuw gebruikt en andere objecten worden niet hernummerd. Beide acties vereisen toegang tot de shipment.

## Productie

```sh
npm run build
npm start
```

De Node-server serveert zowel de gebouwde interface als de API. `PORT` stelt de luisterpoort in; `DATA_DIR` de map voor SQLite en foto's. Deze eerste versie gebruikt SQLite met een enkele serverinstantie.

## Railway

1. Zet deze code in een GitHub-repository en maak in Railway een service vanuit die repository. Railway kan de meegeleverde Dockerfile gebruiken.
2. Koppel een persistent volume aan `/data`. De Dockerfile stelt `DATA_DIR=/data` in. Zonder volume blijven gegevens niet behouden bij een nieuwe deployment.
3. Stel vóór de eerste start een willekeurige `SETUP_TOKEN` in en genereer een HTTPS-domein. Maak via dat domein het eerste beheerdersaccount aan. De healthcheck staat ingesteld op `/api/health`.
4. Gebruik één replica en configureer volumeback-ups. Bij meerdere instanties moet de opslag worden omgezet naar een gedeelde database en objectopslag.

De Dockerfile zet `NODE_ENV=production`, waardoor sessiecookies alleen via HTTPS werken. De eerste beheerder krijgt automatisch toegang tot bestaande shipments. Er is nog geen deployment uitgevoerd.

## Palletlijst en A6-label

Open **Exporteren** bovenaan voor de volledige actieve shipment. **Excel** bevat een overzicht en een tabblad per pallet; **CSV** bevat alle objecten in één bestand met hun palletnaam. **Alle palletlijsten / PDF** maakt één afdrukdocument met een nieuwe sectie per pallet (A4 liggend). **Alle A6-labels / PDF** maakt één document met een label per pallet, ook voor lege palletten. Nog niet toegewezen objecten staan apart in de materiaallijsten en krijgen geen palletlabel. Zoekfilters en palletselecties beperken de export niet. De materiaallijsten nemen jouw zichtbare trackingkolommen over.

Het A6-label bevat het logo, de shipmentnaam en de palletnaam/het palletnummer. De maker of beheerder kan via **Eigen logo toevoegen** een PNG-, JPG- of WebP-logo tot 2 MB uploaden; dit geldt voor alle palletten van de shipment. Zonder upload verschijnt de Palletshipper-markering. Het logo wordt blijvend opgeslagen. Open **Alle A6-labels / PDF** en kies afdrukken of bewaren als PDF. Gebruik A6 (105 × 148 mm), schaal 100% en schakel browserkop- en voetteksten uit. Printerinstellingen kunnen het uiteindelijke formaat beïnvloeden. Alle exports vereisen shipmenttoegang.

## Materiaalimport

- CSV: komma, puntkomma of tab als scheidingsteken; UTF-8.
- Excel: `.xlsx` of `.xls`, eerste werkblad.
- PDF: kolommen worden herkend op basis van tekstposities, ook zonder getekende tabelranden. Herkenbare kolomnamen selecteren automatisch omschrijving, artikelnummer en aantal. Herhaalde kopregels worden overgeslagen en lege cellen blijven in hun kolom. Zonder duidelijke kolommen wordt tekst per regel aangeboden. Controleer de regels: complexe opmaak, afwijkende tabellen en gescande pagina's kunnen niet betrouwbaar worden ingelezen. Scans vereisen OCR, dat nog niet is geïmplementeerd.
- Kies omschrijving, artikelnummer en aantal in het controlescherm. Verwijder ongewenste regels vóór het importeren. Maximaal 2000 objecten per toevoeging.
- Foto's: meerdere JPG-, PNG- of WebP-foto's per pallet, maximaal 15 MB per foto en 10 foto's per upload. **Foto maken** opent de camera/bestandskiezer; **Foto’s toevoegen** laat meerdere bestanden selecteren. Elke upload voegt toe aan de galerij. Klik op een foto om ze groter te openen. Een afzonderlijke foto kan na bevestiging definitief worden verwijderd. Bestaande palletfoto's worden automatisch overgenomen. HEIC moet eerst worden omgezet.

Er zijn geen voorbeeldgegevens vooraf geladen. Begin met een shipment, voeg palletten toe en importeer vervolgens je lijst.

## Controle

```sh
npm run build
npm test
```

### Palletoverzicht en camionlading

Open **Palletoverzicht** bij de actieve shipment. Elke pallet heeft eigen checkboxen voor Out warehouse, In location, Out location en In warehouse. Vink Out warehouse aan zodra de pallet in de camion geladen is; de teller toont hoeveel palletten geladen zijn en hoeveel nog te laden zijn. Je kunt zoeken op palletnaam en filteren op geladen of nog te laden palletten. Via **Inhoud bekijken** open je de objecten en foto’s van die pallet.

Deze statussen worden automatisch opgeslagen en staan volledig los van de objecttracking. Een pallet afvinken wijzigt geen objecten, en objecten afvinken, verplaatsen of verwijderen wijzigt geen palletstatus. Bestaande palletten beginnen met lege palletcheckboxen.

### Shipmentinstellingen

De knop **Shipmentinstellingen** naast de shipmentkeuze bundelt het eigen logo, gebruikersrechten, archiveren en definitief verwijderen. Alleen de maker en beheerders mogen deze instellingen beheren. Het logo wordt hier toegevoegd of gewijzigd en verschijnt op de exports.

Via **Archief** bovenaan kun je gearchiveerde shipments openen. Archiveren behoudt alle gegevens en bestaande toegangsrechten; via de instellingen kun je een shipment herstellen. Verwijderen vereist dat je de exacte shipmentnaam intypt en verwijdert ook alle palletten, objecten, tracking, foto’s, het logo en shipmentgebonden voorkeuren en rechten.

Bij archiveren worden palletfoto’s omgezet naar WebP met kwaliteit 75 en maximaal 1600 × 1600 pixels, met behoud van verhoudingen en correcte oriëntatie. Kleine beelden worden niet vergroot. Alleen kleinere bestanden vervangen het origineel; al gecomprimeerde beelden worden niet opnieuw gecomprimeerd bij herstellen en opnieuw archiveren. Herstellen brengt de oorspronkelijke fotokwaliteit niet terug. Het shipmentlogo blijft ongewijzigd. Nieuwe foto’s toevoegen vereist eerst herstellen. Als een foto onleesbaar is, blijft de shipment ongearchiveerd en blijven de originele beelden behouden.

De browser onthoudt de laatst geopende shipment per gebruikersaccount en opent deze opnieuw na verversen, ook als deze in het archief staat. Een verwijderde of niet meer toegankelijke shipment wordt vervangen door een beschikbare shipment.

In **Palletoverzicht → Trackingkolommen** kun je de vier palletkolommen afzonderlijk tonen of verbergen. Deze voorkeur wordt per gebruiker en shipment opgeslagen, onafhankelijk van de objectkolommen. Verborgen kolommen behouden hun trackingstatus en de laadfilters blijven werken.

Via **Palletoverzicht** kun je een pallet **Hernoemen** of **Verwijderen**. Hernoemen behoudt inhoud, foto’s en tracking en vereist een unieke naam binnen de shipment. Verwijderen vraagt bevestiging: objecten blijven behouden met hun eigen tracking en komen bij **Nog te verdelen**; de palletfoto’s en pallettracking worden verwijderd.

De teller in het palletoverzicht volgt automatisch de eerste trackingstap die nog niet voor alle palletten is voltooid: Out warehouse, In location, Out location en In warehouse. Zodra alle vier stappen voltooid zijn, verschijnt een voltooiingsmelding. Een vinkje weghalen of een nieuwe pallet toevoegen laat de teller teruggaan naar de eerste onvoltooide stap. Zoeken, filters en verborgen kolommen veranderen deze berekening niet.

Via **Shipmentinstellingen → Naam en locatie** kunnen de maker en beheerders de shipmentnaam en bestemming/locatie wijzigen. De nieuwe naam verschijnt ook in exports en labels; alle inhoud, tracking en rechten blijven behouden.

### Samenwerken

De actieve shipment wordt elke vijf seconden bijgewerkt, en bij terugkeer naar het venster. Dit pauzeert tijdens een geopend formulier of een lokale wijziging. Object-, pallet- en shipmentwijzigingen vanuit de app sturen de gelezen versie mee: verouderde invoer of verwijderingen worden geweigerd met een conflictmelding. De app haalt de actuele gegevens op; sluit het formulier en open het opnieuw om verder te werken. Deze controle geldt voor de genoemde wijzig- en verwijderacties; er is nog geen auditlog van wie wat afvinkte. API-clients die zelf verzoeken versturen moeten ook de meegeleverde `revision` meesturen om conflictcontrole te gebruiken.

Shipments hebben een **Bestemming heen**, **Datum heen**, **Bestemming terug** en **Datum terug**, in het aanmaakformulier en bij **Shipmentinstellingen → Naam en locatie**. Bestaande bestemmingen blijven de heenbestemming. Beide bestemmingen en ingevulde datums verschijnen op ieder A6-label; datums worden weergegeven als dd/mm/yyyy.

## Nieuwe installatie vanuit GitHub

De repository bevat alleen code, zonder database, accounts, palletfoto’s of installatiecodes. Na het ophalen van de repository en starten van de backend wordt automatisch een lege database aangemaakt. Lokaal verschijnt de installatiecode in `data/setup-token.txt`; op Railway stel je vooraf `SETUP_TOKEN` in. Daarmee maak je het eerste beheerdersaccount aan. Je eigen bestaande lokale gegevens blijven buiten Git en worden niet gewist.
