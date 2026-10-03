# Working copy and development server

The user selected `C:\Users\credi\Documents\UniFood` as the primary working copy. A separate, older checkout exists at `C:\Users\credi\OneDrive\Desktop\UniFood`; it does not share these source files.

Keep changes in this repository. Use `npm run dev` from its root (or `iniciar-unifood.cmd`) for the application on port 3000, available on localhost and the LAN. The initial route `/` must show or redirect to the login, with access to student registration. Port 3100 is reserved for browser tests.

If the user sees an old UI, inspect which working copy owns the application port. Starting an additional copy on 3001 is not a persistent fix for the user's normal startup workflow.

Check both IPv4 and IPv6 listeners: on this Windows machine, an old checkout listening on `::` and another server listening on `0.0.0.0` have served different applications on the same port. The canonical startup binds to `::`; verify localhost, 127.0.0.1, ::1 and the LAN address when changing startup settings.

Read `unifood-web/AGENTS.md` before changing frontend code.
