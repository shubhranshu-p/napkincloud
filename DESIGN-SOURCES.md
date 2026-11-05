# Visual and interaction research

The user supplied software-architecture, GPU flow, gateway, and cache-routing references. These informed the use of distinct component shapes, readable directional arrows, conditional paths, and restrained category colors. No referenced poster, logo, or screenshot is redistributed by the app.

Inspected public projects:

- Excalidraw: https://github.com/excalidraw/excalidraw — canvas, image import, and diagram export interaction conventions. MIT licensed; no source or artwork copied.
- System Design Simulator: https://github.com/Faisal-Fayaz/system-design-simulator — visual request-flow and stress-test interaction research. No source or assets copied; no dependency or license assumption made.

All scenario diagrams are original SVG rendered from the same graphs passed to the simulator. The renderer is shared between the browser, examples endpoint, and SVG export. Color/shapes identify component roles. Request arrows show direction; response paths are implicit.

This update uses a local saved-run list with an explicit restore action, informed by Excalidraw’s history conventions (https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api). No Excalidraw code was copied. PostgreSQL standby documentation (https://www.postgresql.org/docs/current/warm-standby.html) informed the distinction between read-only standby replication and independent writable tenant stores. NapkinCloud models the latter with explicit additional resources; it does not claim that read replicas scale writes.

The four uploadable demo PNGs in `Demo Image/` are rendered from the exact executable graphs in `src/demos.mjs`, using the shared original SVG renderer. Their matching JSON files contain the graph and sample workload. No third-party architecture screenshots are included as demo inputs.
