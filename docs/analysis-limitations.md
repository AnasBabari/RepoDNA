# Static Analysis Limitations & Boundaries

RepoDNA performs **purely static syntax and structural analysis** without executing repository code. This design prioritizes speed and security, but entails honest boundaries regarding dynamic runtime features.

---

## Known Boundaries

### 1. Dynamic Imports & Reflection
- **What is detected**: Static import statements (`import foo from 'bar'`, `from app.services import UserService`, `require('./routes')`).
- **Limitation**: Imports constructed dynamically at runtime (e.g. `import(dynamicModulePath)` or `__import__(var_name)`) cannot be statically resolved to a deterministic target file.
- **Diagnostic**: Reported under `diagnostics` as `UNRESOLVED_DYNAMIC_IMPORT`.

### 2. Runtime Dependency Injection & Metaprogramming
- **What is detected**: Explicit decorator injection (`@router.get('/')`, `Depends(get_db)`), class constructors, and standard module exports.
- **Limitation**: Dynamic container bindings (e.g. runtime IoC factories that dynamically bind interface symbols based on environment variables) are grouped with lower heuristic confidence.

### 3. Dynamic Route Generation
- **What is detected**: Declarative route definitions (FastAPI `@router.get`, Express `router.post`, Flask `@app.route`, Next.js App/Pages Router file paths).
- **Limitation**: Routes generated through programmatic runtime loops (e.g. `for route in database_routes: app.add_url_rule(route)`) are not statically enumerated.

### 4. Heuristic Call Graph Edges
- **Confidence Model**:
  - `1.00`: Same file / same class exact resolution.
  - `0.95`: Direct named import resolution (`import { UserService } from './user'`).
  - `0.80`: Repository-unique symbol resolution.
  - `0.55`: Heuristic name matching across modules.

---

## Why Pure Static Analysis?

Running untrusted repository code inside dynamic runtimes poses severe security and denial-of-service risks. By relying exclusively on deterministic static analysis, RepoDNA ensures:
1. **Safety**: Zero risk of executing malicious payload scripts or crypto miners.
2. **Speed**: Instantaneous sub-second analysis times across thousands of files.
3. **Portability**: 100% client-side execution in standard web browsers with zero backend dependencies.
