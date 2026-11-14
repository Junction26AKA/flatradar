/**
 * Every user-visible string, in English and Finnish. Keys are grouped by screen.
 * A message is a string, or a function of its variables. The `satisfies` check below makes a missing
 * translation a type error, so EN and FI can't drift apart.
 *
 * Finnish copy: written for the demo; worth a read-through by a native speaker before launch.
 */
type Msg = string | ((v: any) => string); // eslint-disable-line @typescript-eslint/no-explicit-any
type Pair = { en: Msg; fi: Msg };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const MESSAGES = {
  // ---- shared
  'lang.label': { en: 'Language', fi: 'Kieli' },
  'live.live': { en: 'Live', fi: 'Livenä' },
  'live.replay': { en: 'Replaying sample', fi: 'Esimerkkidata' },
  'live.connecting': { en: 'Connecting…', fi: 'Yhdistetään…' },
  'live.replayTitle': { en: 'Server unreachable: replaying sample data', fi: 'Palvelimeen ei saada yhteyttä: näytetään esimerkkidataa' },
  'kind.sale': { en: 'Buy', fi: 'Osta' },
  'kind.rent': { en: 'Rent', fi: 'Vuokraa' },
  'kind.forSale': { en: 'For sale', fi: 'Myytävänä' },
  'kind.forRent': { en: 'For rent', fi: 'Vuokrattavana' },
  'kind.buyOrRent': { en: 'Buy or rent', fi: 'Osta tai vuokraa' },
  'confidence.low': { en: 'low', fi: 'heikko' },
  'confidence.medium': { en: 'medium', fi: 'kohtalainen' },
  'confidence.high': { en: 'high', fi: 'hyvä' },

  // ---- deal badge / card
  'deal.good': { en: (v: { p: string }) => `−${v.p}% vs fair`, fi: (v: { p: string }) => `−${v.p} % käyvästä` }, // not "−18 % alle käyvän": minus + alle is a double negative
  'deal.bad': { en: (v: { p: string }) => `+${v.p}% overpriced`, fi: (v: { p: string }) => `+${v.p} % ylihintainen` },
  'deal.fair': { en: (v: { p: string }) => `±${v.p}% fair price`, fi: (v: { p: string }) => `±${v.p} % käypä hinta` },
  'deal.title': { en: 'Asking price vs our fair-value estimate', fi: 'Pyyntihinta verrattuna arvioimaamme käypään hintaan' },
  'price.dropped': { en: '↓ Price dropped', fi: '↓ Hinta laski' },
  'price.raised': { en: '↑ Price raised', fi: '↑ Hinta nousi' },
  'card.seen': { en: (v: { ago: string }) => `seen ${v.ago}`, fi: (v: { ago: string }) => `nähty ${v.ago}` },
  'card.scoring': { en: 'scoring…', fi: 'arvioidaan…' },
  'card.noScore': { en: 'no score yet', fi: 'ei arviota vielä' },
  'card.noScoreTitle': { en: 'Not enough comparable listings yet', fi: 'Vertailukohteita ei ole vielä tarpeeksi' },
  'card.fair': { en: 'fair', fi: 'käypä' },
  'card.lowConfidence': { en: 'low confidence', fi: 'epävarma arvio' },
  'card.matches': { en: 'Matches your search', fi: 'Vastaa hakuasi' },
  'card.roomsOriginal': { en: (v: { s: string }) => `Original listing: ${v.s}`, fi: (v: { s: string }) => v.s },
  'flag.checking': { en: '(checking)', fi: '(tarkistetaan)' },
  'flag.failed': { en: 'This check failed', fi: 'Tarkistus epäonnistui' },

  // ---- time
  'ago.s': { en: (v: { n: number }) => `${v.n} s ago`, fi: (v: { n: number }) => `${v.n} s sitten` },
  'ago.min': { en: (v: { n: number }) => `${v.n} min ago`, fi: (v: { n: number }) => `${v.n} min sitten` },
  'ago.h': { en: (v: { n: number }) => `${v.n} h ago`, fi: (v: { n: number }) => `${v.n} h sitten` },
  'ago.d': { en: (v: { n: number }) => `${v.n} d ago`, fi: (v: { n: number }) => `${v.n} pv sitten` },
  'unit.month': { en: '/mo', fi: '/kk' },
  'unit.rooms': { en: (v: { n: number }) => `${v.n} ${plural(v.n, 'room', 'rooms')}`, fi: (v: { n: number }) => `${v.n} ${v.n === 1 ? 'huone' : 'huonetta'}` },

  // ---- landing
  'lp.how': { en: 'How it works', fi: 'Näin se toimii' },
  'lp.pricing': { en: 'Pricing model', fi: 'Arvonmääritys' }, // "hinnoittelumalli" would mean our own price plans
  'lp.liveMap': { en: 'Live map', fi: 'Livekartta' },
  'lp.signIn': { en: 'Sign in', fi: 'Kirjaudu' },
  'lp.start': { en: 'Start saving →', fi: 'Ala säästää →' },
  'lp.open': { en: 'Open FlatRadar →', fi: 'Avaa FlatRadar →' },
  'lp.eyebrow': { en: 'Helsinki · live on Etuovi, Vuokraovi + Oikotie', fi: 'Helsinki · livenä Etuovesta, Vuokraovesta ja Oikotieltä' },
  'lp.hero': { en: 'Stop overpaying for Helsinki flats.', fi: 'Älä maksa ylihintaa Helsingin asunnoista.' }, // covers renters too
  'lp.heroSub': {
    en: 'Every new listing scored against comparable flats, an ML model and Statistics Finland prices, in seconds, with the hidden costs called out.',
    fi: 'Jokainen uusi ilmoitus arvioidaan sekunneissa vertailukohteita, koneoppimismallia ja Tilastokeskuksen hintoja vasten, ja piilokulut nostetaan esiin.',
  },
  'lp.odoCap': {
    en: (v: { n: number; sample: boolean }) => `of overpricing spotted this week${v.n ? ` across ${v.n} flats` : ''}${v.sample ? ' (sample data)' : ''}`,
    fi: (v: { n: number; sample: boolean }) => `ylihintaa havaittu tällä viikolla${v.n ? ` ${v.n} asunnossa` : ''}${v.sample ? ' (esimerkkidata)' : ''}`,
  },
  'lp.seeHow': { en: 'See how it works', fi: 'Katso miten se toimii' },
  'lp.hint': { en: 'scroll ↓ to watch the money', fi: 'vieritä ↓ ja seuraa rahaa' },
  'lp.priceH': { en: 'We know what it’s really worth.', fi: 'Tiedämme, minkä arvoinen se oikeasti on.' },
  'lp.priceSub': {
    en: 'Comparable flats on the market within 1 km (2.5 km where they’re sparse), a model trained on Helsinki listings, and Statistics Finland’s postcode prices, blended into one fair price.',
    fi: 'Myynnissä olevat vertailuasunnot kilometrin säteellä (harvaan asutulla alueella 2,5 km), helsinkiläisillä ilmoituksilla opetettu malli ja Tilastokeskuksen postinumerokohtaiset hinnat yhdistettynä yhdeksi käyväksi hinnaksi.',
  },
  'lp.costsH': { en: 'See the costs they don’t put in the headline.', fi: 'Näe kulut, joita otsikossa ei kerrota.' },
  'lp.costsSub': {
    en: 'We read the renovation plans, the housing company’s papers and the city’s street-works permits, so a “cheap” flat with a pipe renovation next year doesn’t look cheap any more.',
    fi: 'Luemme korjaussuunnitelmat, taloyhtiön paperit ja kaupungin katutyöluvat, joten ”halpa” asunto, jossa on ensi vuonna putkiremontti, ei enää näytä halvalta.',
  },
  'lp.pricingH': { en: 'Three sources. One fair price.', fi: 'Kolme lähdettä. Yksi käypä hinta.' },
  'lp.pricingSub': {
    en: 'Every number is shown with where it came from. The blend gets a confidence level, and we publish the model’s error, not just its answer.',
    fi: 'Jokaisen luvun lähde näytetään. Yhdistelmä saa varmuustason, ja kerromme mallin virheen emmekä vain sen vastausta.',
  },
  'lp.livePill': {
    en: (v: { n: string }) => `${v.n} flats for sale watched`,
    fi: (v: { n: string }) => `${v.n} myytävää asuntoa seurannassa`,
  },
  'lp.livePillNone': { en: 'Watching Etuovi, Vuokraovi + Oikotie', fi: 'Seurataan Etuovea, Vuokraovea ja Oikotietä' },
  'lp.liveH': { en: 'Watching Helsinki right now.', fi: 'Seuraamme Helsinkiä juuri nyt.' },
  'lp.liveSub': {
    en: 'New listings and price drops are scored within seconds. Good deals light up and land in your inbox.',
    fi: 'Uudet ilmoitukset ja hinnanlaskut arvioidaan sekunneissa. Hyvät kaupat korostuvat ja tulevat sähköpostiisi.',
  },
  'lp.tickerLabel': { en: 'Newest scored listings', fi: 'Uusimmat arvioidut ilmoitukset' },
  'lp.ctaH': { en: 'Your savings start here.', fi: 'Säästösi alkavat tästä.' },
  'lp.ctaPrimary': { en: 'Start watching, it’s free →', fi: 'Aloita seuranta, se on ilmaista →' },
  'lp.ctaMap': { en: 'See the live map', fi: 'Katso livekarttaa' },
  'lp.ctaSub': {
    en: 'Set a search like “2 rooms under €280k in Kallio”. We’ll email you the moment a good deal appears.',
    fi: 'Tee haku, esimerkiksi ”2 huonetta alle 280 000 € Kalliossa”. Lähetämme sähköpostia heti, kun hyvä kauppa ilmestyy.',
  },
  'lp.asking': { en: 'Asking', fi: 'Pyyntihinta' },
  'lp.example': { en: 'example', fi: 'esimerkki' },
  'lp.exampleListing': { en: 'example listing', fi: 'esimerkki-ilmoitus' },
  'lp.overpriced': { en: (v: { p: string }) => `Overpriced +${v.p}%`, fi: (v: { p: string }) => `Ylihintainen +${v.p} %` },
  'lp.fairValue': { en: 'Fair value', fi: 'Käypä hinta' },
  'lp.tooHigh': { en: (v: { eur: string }) => `${v.eur} too high`, fi: (v: { eur: string }) => `${v.eur} liian kallis` },
  'lp.fair': { en: 'Fair', fi: 'Käypä' },
  'lp.confidence': { en: (v: { c: string }) => `confidence: ${v.c}`, fi: (v: { c: string }) => `varmuus: ${v.c}` },
  'lp.src.comps': { en: 'Comparables', fi: 'Vertailukohteet' },
  'lp.src.compsSub': { en: (v: { n: number; km: number }) => `${v.n} flats ≤${v.km} km`, fi: (v: { n: number; km: number }) => `${v.n} asuntoa ≤${v.km} km` },
  'lp.src.compsNone': { en: 'not enough nearby', fi: 'liian vähän lähellä' },
  'lp.src.model': { en: 'ML model', fi: 'Koneoppimismalli' },
  'lp.src.modelTraining': { en: 'training', fi: 'opetetaan' },
  'lp.src.stat': { en: 'Statistics Finland', fi: 'Tilastokeskus' },
  'lp.src.statNone': { en: 'no postcode data', fi: 'ei postinumerodataa' },

  // ---- app shell
  'app.feed': { en: 'Feed', fi: 'Syöte' },
  'app.searches': { en: 'My searches', fi: 'Omat haut' },
  'app.account': { en: 'Account', fi: 'Tili' },
  'app.offline': { en: 'Offline demo account', fi: 'Offline-demotili' },
  'app.signOut': { en: 'Sign out', fi: 'Kirjaudu ulos' },

  // ---- feed
  'feed.title': { en: 'New in Helsinki', fi: 'Uutta Helsingissä' },
  'feed.of': { en: (v: { n: number }) => ` of ${v.n}`, fi: (v: { n: number }) => ` / ${v.n}` },
  'feed.good': { en: 'Good deals', fi: 'Hyvät kaupat' },
  'feed.match': { en: 'Matches my search', fi: 'Vastaa hakuani' },
  'feed.map': { en: 'Map', fi: 'Kartta' },
  'feed.filters': { en: 'Filters', fi: 'Suodattimet' },
  'feed.listings': { en: 'Listings', fi: 'Ilmoitukset' },
  'feed.sample': { en: 'Can’t reach the server, so this is sample data.', fi: 'Palvelimeen ei saada yhteyttä, joten tämä on esimerkkidataa.' },
  'feed.toast': { en: (v: { where: string; deal: string }) => `New deal just landed · ${v.where} ${v.deal}`, fi: (v: { where: string; deal: string }) => `Uusi hyvä kauppa · ${v.where} ${v.deal}` },
  'feed.noMatch': { en: 'Nothing matches these filters right now.', fi: 'Mikään ei vastaa näitä suodattimia juuri nyt.' },
  'feed.emptySale': { en: 'No flats for sale yet. New ones appear here the moment they’re listed.', fi: 'Ei vielä myytäviä asuntoja. Uudet näkyvät tässä heti, kun ne ilmoitetaan.' },
  'feed.emptyRent': { en: 'No rentals yet. New ones appear here the moment they’re listed.', fi: 'Ei vielä vuokra-asuntoja. Uudet näkyvät tässä heti, kun ne ilmoitetaan.' },
  'feed.more': { en: (v: { n: number }) => `Show ${v.n} more`, fi: (v: { n: number }) => `Näytä ${v.n} lisää` },
  'feed.mapLabel': { en: 'Map', fi: 'Kartta' },
  'feed.detail': { en: 'Listing detail', fi: 'Ilmoituksen tiedot' },
  'feed.close': { en: 'Close detail', fi: 'Sulje tiedot' },
  'map.clusterTitle': { en: (v: { n: number }) => `${v.n} listings. Click to zoom in.`, fi: (v: { n: number }) => `${v.n} ilmoitusta. Lähennä klikkaamalla.` },
  'map.best': { en: (v: { d: string }) => `Best deal inside: ${v.d}`, fi: (v: { d: string }) => `Paras kauppa: ${v.d}` },
  'map.notScored': { en: 'not scored', fi: 'ei arvioitu' },

  // ---- detail (scaffold until the full drawer)
  'detail.loading': { en: 'Loading…', fi: 'Ladataan…' },
  'detail.notFound': { en: 'Listing not found.', fi: 'Ilmoitusta ei löytynyt.' },
  'detail.back': { en: 'Back to feed', fi: 'Takaisin syötteeseen' },
  'detail.openPortal': { en: (v: { site: string }) => `View on ${v.site} ↗`, fi: (v: { site: string }) => `Avaa ${v.site} ↗` },
  'detail.fair': {
    en: (v: { price: string; pct: number }) => `Fair price ${v.price} · ${v.pct === 0 ? 'asking matches it' : `asking is ${Math.abs(v.pct)}% ${v.pct < 0 ? 'below' : 'above'}`}`,
    fi: (v: { price: string; pct: number }) => `Käypä hinta ${v.price} · ${v.pct === 0 ? 'pyyntihinta vastaa sitä' : `pyyntihinta on ${Math.abs(v.pct)} % ${v.pct < 0 ? 'alle' : 'yli'}`}`,
  },
  'detail.alsoOn': { en: 'Also listed on', fi: 'Myös täällä:' },

  // ---- photos (Cloudinary)
  'ph.title': { en: 'Photos', fi: 'Kuvat' },
  'ph.analysing': { en: 'Reading the photos with Cloudinary AI Vision…', fi: 'Luetaan kuvia Cloudinary AI Visionilla…' },
  'ph.error': { en: 'The photos could not be processed.', fi: 'Kuvia ei voitu käsitellä.' },
  'ph.notAnalysed': { en: 'Photos shown without AI analysis.', fi: 'Kuvat näytetään ilman tekoälyanalyysiä.' },
  'ph.count': { en: (v: { n: number }) => `${v.n} ${plural(v.n, 'photo', 'photos')}`, fi: (v: { n: number }) => `${v.n} kuvaa` },
  'ph.photo': { en: (v: { n: number }) => `Photo ${v.n}`, fi: (v: { n: number }) => `Kuva ${v.n}` },
  'ph.found': { en: 'Found in the photos', fi: 'Kuvista löytyi' },
  'ph.show': { en: 'Show photo', fi: 'Näytä kuva' },
  'ph.nothing': { en: 'Nothing to flag in the photos.', fi: 'Kuvissa ei ollut huomautettavaa.' },
  'ph.renovate': { en: 'See it renovated', fi: 'Näytä remontoituna' },
  'ph.original': { en: 'Back to the original', fi: 'Takaisin alkuperäiseen' },
  'ph.generating': { en: 'Cloudinary generative AI is redoing this room (about 15 s the first time)…', fi: 'Cloudinaryn generatiivinen tekoäly remontoi huonetta (ensimmäisellä kerralla noin 15 s)…' },
  'ph.genFailed': { en: 'The renovated version could not be generated.', fi: 'Remontoitua versiota ei saatu luotua.' },
  'ph.before': { en: 'Now', fi: 'Nyt' },
  'ph.after': { en: 'After renovation (AI)', fi: 'Remontin jälkeen (tekoäly)' },
  'ph.slider': { en: 'Drag to compare before and after', fi: 'Vedä vertaillaksesi ennen ja jälkeen' },
  'ph.cost': { en: (v: { c: string }) => `Rough cost of this kind of renovation: ${v.c}`, fi: (v: { c: string }) => `Tällaisen remontin karkea hinta: ${v.c}` },
  'ph.disclaimer': { en: 'An AI illustration of what new surfaces could look like, not a quote or a plan.', fi: 'Tekoälyn havainnekuva uusista pinnoista, ei tarjous tai suunnitelma.' },
  'ph.room.kitchen': { en: 'Kitchen', fi: 'Keittiö' },
  'ph.room.bathroom': { en: 'Bathroom', fi: 'Kylpyhuone' },
  'ph.room.exterior': { en: 'Outside', fi: 'Ulkoa' },
  'ph.room.plan': { en: 'Floor plan', fi: 'Pohjapiirros' },
  'ph.room.room': { en: 'Room', fi: 'Huone' },
  'ph.share': { en: 'Share card', fi: 'Jakokortti' },
  'ph.shareHint': { en: 'Made on the fly by Cloudinary from the photo, the deal and the price. The alert email uses the same card.', fi: 'Cloudinary tekee kortin lennosta kuvasta, hinnasta ja arviosta. Hälytyssähköposti käyttää samaa korttia.' },
  'ph.copy': { en: 'Copy image link', fi: 'Kopioi kuvan linkki' },
  'ph.copied': { en: 'Link copied', fi: 'Linkki kopioitu' },
  'ph.open': { en: 'Open image', fi: 'Avaa kuva' },
  'ph.shareBtn': { en: 'Share…', fi: 'Jaa…' },

  // ---- sign in
  'si.brand': {
    en: 'Every new Helsinki listing, scored in seconds, with the hidden costs called out before you book a viewing.',
    fi: 'Jokainen uusi helsinkiläinen ilmoitus arvioituna sekunneissa, piilokulut esillä ennen kuin varaat näytön.',
  },
  'si.upH': { en: 'Start saving', fi: 'Ala säästää' },
  'si.inH': { en: 'Welcome back', fi: 'Tervetuloa takaisin' },
  'si.upSub': { en: 'Tell us where to send deals and what you’re looking for.', fi: 'Kerro, minne lähetämme kaupat ja mitä etsit.' },
  'si.inSub': { en: 'Sign in to see your feed and alerts.', fi: 'Kirjaudu nähdäksesi syötteesi ja hälytyksesi.' },
  'si.name': { en: 'Name', fi: 'Nimi' },
  'si.namePh': { en: 'Your name', fi: 'Nimesi' },
  'si.email': { en: 'Email', fi: 'Sähköposti' },
  'si.emailPh': { en: 'you@example.com', fi: 'sina@esimerkki.fi' },
  'si.password': { en: 'Password', fi: 'Salasana' },
  'si.passwordPh': { en: 'At least 8 characters', fi: 'Vähintään 8 merkkiä' },
  'si.first': { en: 'Your first search', fi: 'Ensimmäinen hakusi' },
  'si.lookingTo': { en: 'Looking to', fi: 'Haluan' },
  // the form's options complete "Haluan …", so they're infinitives (the app's Buy/Rent tabs use kind.sale / kind.rent)
  'si.kindSale': { en: 'Buy', fi: 'Ostaa' },
  'si.kindRent': { en: 'Rent', fi: 'Vuokrata' },
  'si.maxPrice': { en: 'Max price (€)', fi: 'Enimmäishinta (€)' },
  'si.any': { en: 'Any', fi: 'Mikä tahansa' },
  'si.postcodesPh': { en: 'All of Helsinki, or e.g. 00530, 00500', fi: 'Koko Helsinki, tai esim. 00530, 00500' },
  'si.maxRent': { en: 'Max rent (€/month)', fi: 'Enimmäisvuokra (€/kk)' },
  'si.minRooms': { en: 'Min rooms', fi: 'Huoneita vähintään' },
  'si.postcodes': { en: 'Postcodes', fi: 'Postinumerot' },
  'si.minDeal': { en: 'Only alert me for flats at least this % below fair value', fi: 'Hälytä vain, kun hinta on vähintään näin monta % alle käyvän hinnan' },
  'si.minDealHint': { en: '0 = alert me about every match', fi: '0 = hälytä jokaisesta osumasta' },
  'si.busy': { en: 'One moment…', fi: 'Hetki…' },
  'si.submitUp': { en: 'Start watching →', fi: 'Aloita seuranta →' },
  'si.submitIn': { en: 'Sign in →', fi: 'Kirjaudu →' },
  'si.toIn': { en: 'Already watching? Sign in with your email', fi: 'Onko sinulla jo tili? Kirjaudu sisään' },
  'si.toUp': { en: 'New here? Create a search', fi: 'Uusi täällä? Luo haku' },
  'si.exists': { en: 'You already have an account with that email. Sign in instead.', fi: 'Sähköpostilla on jo tili. Kirjaudu sisään.' },
  'si.error': { en: 'Something went wrong', fi: 'Jokin meni vikaan' },

  // ---- my searches
  'sr.title': { en: 'My searches', fi: 'Omat haut' },
  'sr.lead': { en: 'When a new listing matches one of these, we email', fi: 'Kun uusi ilmoitus vastaa jotakin näistä, lähetämme sähköpostia osoitteeseen' },
  'sr.add': { en: '+ Add search', fi: '+ Lisää haku' },
  'sr.maxTitle': { en: (v: { n: number }) => `You can keep up to ${v.n} searches`, fi: (v: { n: number }) => `Voit tallentaa enintään ${v.n} hakua` },
  'sr.full': { en: (v: { n: number }) => `You can keep up to ${v.n} searches. Delete one to add another.`, fi: (v: { n: number }) => `Voit tallentaa enintään ${v.n} hakua. Poista yksi lisätäksesi uuden.` },
  'sr.new': { en: 'New search', fi: 'Uusi haku' },
  'sr.first': { en: 'Create your first search', fi: 'Luo ensimmäinen hakusi' },
  'sr.edit': { en: 'Edit search', fi: 'Muokkaa hakua' },
  // search-card titles are noun phrases: "Osto · 2+ huonetta", not the imperative "Osta"
  'sr.kindSale': { en: 'Buy', fi: 'Osto' },
  'sr.kindRent': { en: 'Rent', fi: 'Vuokraus' },
  'sr.anywhere': { en: 'Anywhere in Helsinki', fi: 'Missä tahansa Helsingissä' },
  'sr.count': {
    en: (v: { n: number }) => `${plural(v.n, 'listing matches', 'listings match')} right now`,
    fi: (v: { n: number }) => `${plural(v.n, 'ilmoitus vastaa', 'ilmoitusta vastaa')} juuri nyt`,
  },
  'sr.seeMatches': { en: 'See matches', fi: 'Näytä osumat' },
  'sr.editBtn': { en: 'Edit', fi: 'Muokkaa' },
  'sr.delete': { en: 'Delete', fi: 'Poista' },
  'sr.confirmDelete': { en: (v: { t: string }) => `Delete “${v.t}”? You’ll stop getting alerts for it.`, fi: (v: { t: string }) => `Poistetaanko ”${v.t}”? Et saa siitä enää hälytyksiä.` },
  'sr.saveError': { en: 'Couldn’t save your searches', fi: 'Hakujen tallennus epäonnistui' },
  'sr.alertsH': { en: 'Alerts sent while you’ve been here', fi: 'Täällä ollessasi lähetetyt hälytykset' },
  'sr.emailed': { en: (v: { to: string; ago: string }) => `emailed ${v.to} · ${v.ago}`, fi: (v: { to: string; ago: string }) => `lähetetty ${v.to} · ${v.ago}` },
  'sr.noAlerts': { en: 'None yet. They appear here live as new listings match anyone’s search.', fi: 'Ei vielä. Ne näkyvät tässä livenä, kun uudet ilmoitukset vastaavat jonkun hakua.' },
  'sr.upToRent': { en: (v: { eur: string }) => `up to ${v.eur}/mo`, fi: (v: { eur: string }) => `enintään ${v.eur}/kk` },
  'sr.upTo': { en: (v: { eur: string }) => `up to ${v.eur}`, fi: (v: { eur: string }) => `enintään ${v.eur}` },
  'sr.roomsPlus': { en: (v: { n: number }) => `${v.n}+ rooms`, fi: (v: { n: number }) => `${v.n}+ huonetta` },
  'sr.dealAny': { en: 'Every new listing that fits', fi: 'Jokainen sopiva uusi ilmoitus' },
  'sr.dealFair': { en: 'Only at or below fair value', fi: 'Vain käypä hinta tai alle' },
  'sr.dealPct': { en: (v: { p: number }) => `Only at least ${v.p}% below fair value`, fi: (v: { p: number }) => `Vain vähintään ${v.p} % alle käyvän hinnan` },
  'sr.optAny': { en: 'Any listing (score not needed)', fi: 'Mikä tahansa ilmoitus (arviota ei tarvita)' },
  'sr.optFair': { en: 'At or below fair value', fi: 'Käypä hinta tai alle' },
  'sr.optPct': { en: (v: { p: number }) => `At least ${v.p}% below fair value`, fi: (v: { p: number }) => `Vähintään ${v.p} % alle käyvän hinnan` },
  'sr.any': { en: 'Any', fi: 'Ei väliä' },
  'sr.postcodesPh': { en: '00530, 00500 (empty = all of Helsinki)', fi: '00530, 00500 (tyhjä = koko Helsinki)' },
  'sr.badCodes': { en: (v: { c: string }) => `Postcodes are 5 digits: ${v.c}`, fi: (v: { c: string }) => `Postinumerossa on 5 numeroa: ${v.c}` },
  'sr.emailMe': { en: 'Email me about', fi: 'Sähköpostihälytys' },
  'sr.saving': { en: 'Saving…', fi: 'Tallennetaan…' },
  'sr.save': { en: 'Save search', fi: 'Tallenna haku' },
  'sr.cancel': { en: 'Cancel', fi: 'Peruuta' },

  // ---- errors from the server / network (lib/api.ts, server.mjs)
  'srv.wrongPassword': { en: 'Wrong email or password.', fi: 'Väärä sähköposti tai salasana.' },
  'srv.exists': { en: 'You already have an account with that email. Sign in instead.', fi: 'Sähköpostilla on jo tili. Kirjaudu sisään.' },
  'srv.badEmail': { en: 'Please enter a valid email address.', fi: 'Anna kelvollinen sähköpostiosoite.' },
  'srv.shortPassword': { en: 'The password must be at least 8 characters.', fi: 'Salasanassa on oltava vähintään 8 merkkiä.' },
  'srv.unreachable': { en: 'Can’t reach the server. Try again in a moment.', fi: 'Palvelimeen ei saada yhteyttä. Yritä hetken päästä uudelleen.' },

  // ---- error page
  'err.title': { en: 'Something went wrong', fi: 'Jokin meni vikaan' },
  'err.body': { en: 'This screen hit an error. Reloading usually fixes it.', fi: 'Tällä näkymällä tapahtui virhe. Sivun uudelleenlataus yleensä auttaa.' },
  'err.reload': { en: 'Reload', fi: 'Lataa uudelleen' },
  'err.back': { en: 'Back to the feed', fi: 'Takaisin syötteeseen' },
} satisfies Record<string, Pair>;

export type MessageKey = keyof typeof MESSAGES;
export const isMessageKey = (k: string): k is MessageKey => Object.prototype.hasOwnProperty.call(MESSAGES, k);

/**
 * Turn an error into something we can show in either language: a message key for errors we know
 * (server texts in server.mjs / lib/auth.mjs, network failures), otherwise the text as sent.
 * Store the result in state and translate at render time, so it follows a language switch.
 */
export function errorMessage(e: unknown, fallback: MessageKey): MessageKey | string {
  const text = e instanceof Error ? e.message : '';
  if (/wrong email or password/i.test(text)) return 'srv.wrongPassword';
  if (/account exists/i.test(text)) return 'srv.exists';
  if (/valid email/i.test(text)) return 'srv.badEmail';
  if (/password must be at least/i.test(text)) return 'srv.shortPassword';
  if (/can.t reach the server/i.test(text)) return 'srv.unreachable';
  return text || fallback;
}

/** The one message lookup (used by the useI18n() hook and by the plain formatters in format.ts). */
export function translate(lang: 'en' | 'fi', key: MessageKey, vars?: Record<string, unknown>): string {
  const m = MESSAGES[key][lang] as string | ((v: Record<string, unknown>) => string);
  return typeof m === 'function' ? m(vars ?? {}) : m;
}
