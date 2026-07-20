# BitBonsai v0.2.0

Released 2026-07-20 from commit `fix(backend): Nest module graph + DI correctness`.

This release fixes the NestJS module graph so the all-in-one image boots a fully-wired backend that answers /api/v1/health 200.

Pull the image:

```
docker pull lucidfabrics/bitbonsai:0.2.0
```

Install via Unraid:
1. Settings -> Community Applications -> "Template repositories" -> add:
   `https://raw.githubusercontent.com/lucid-fabrics/bitbonsai/main/unraid-release/0.2.0/template.xml`
2. Apps tab -> search "BitBonsai" -> Install.
