import main
paths = sorted(set(getattr(r, 'path', '') for r in main.app.routes))
print("TOTAL_ROUTES", len(main.app.routes))
for p in paths:
    print(p)
