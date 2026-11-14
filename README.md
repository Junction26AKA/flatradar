# FlatRadar

FlatRadar watches Helsinki flats for sale (Etuovi, Oikotie) and for rent (Vuokraovi, Oikotie) on the live web. Within seconds of a listing appearing or its price dropping, it:
- scores the price against comparable listings, an ML model and Statistics Finland postcode prices
- flags hidden costs such as upcoming renovations and housing company debt
- flags major street works nearby, from the City of Helsinki permit register
- alerts users who are watching for that kind of flat

Built for Junction 2026 (Context.dev track).

- [TEAM.md](TEAM.md): setup and what each person is doing
- [PLAN.md](PLAN.md): the plan and the Step 0 findings
- [docs/contracts.md](docs/contracts.md): the data, API and SSE shapes we share
