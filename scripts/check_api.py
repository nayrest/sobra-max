#!/usr/bin/env python3
"""Прогон проверок из DATA-API.yaml против работающего API.

Использование:
    python3 scripts/check_api.py DATA-API.yaml --env .env
    python3 scripts/check_api.py DATA-API.yaml --base-url http://localhost:3000/api --env .env

Нужен только PyYAML:  pip install pyyaml   (или: sudo apt install python3-yaml)
Код выхода 0 — все обязательные проверки прошли, 1 — есть ошибки.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import yaml
except ImportError:
    sys.exit("Нужен PyYAML: pip install pyyaml  (или sudo apt install python3-yaml)")


# ---------- подстановки ----------

def load_env_file(path):
    values = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def substitute(value, env, saved):
    """${ENV} — из окружения, {{name}} — из сохранённых ответов."""
    if isinstance(value, str):
        def env_repl(m):
            name = m.group(1)
            if name not in env or env[name] == "":
                raise KeyError(f"не задана переменная окружения {name}")
            return env[name]

        def saved_repl(m):
            name = m.group(1)
            if name not in saved:
                raise KeyError(f"нет сохранённого значения {{{{{name}}}}} — упала одна из прошлых проверок")
            return str(saved[name])

        value = re.sub(r"\$\{(\w+)\}", env_repl, value)
        return re.sub(r"\{\{(\w+)\}\}", saved_repl, value)
    if isinstance(value, dict):
        return {k: substitute(v, env, saved) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute(v, env, saved) for v in value]
    return value


def json_path(data, path):
    """Простой JSONPath: $.a.b[0].c"""
    if not path.startswith("$"):
        raise ValueError(f"путь должен начинаться с $: {path}")
    current = data
    for part in re.findall(r"\.(\w+)|\[(\d+)\]", path[1:]):
        key, index = part
        current = current[key] if key else current[int(index)]
    return current


# ---------- проверка формы ответа ----------

TYPES = {
    "object": dict, "array": list, "string": str,
    "integer": int, "number": (int, float), "boolean": bool,
}


def validate(value, schema, where="$"):
    errors = []
    if not schema:
        return errors
    expected_type = schema.get("type")
    if expected_type:
        py_type = TYPES[expected_type]
        ok = isinstance(value, py_type) and not (expected_type in ("integer", "number") and isinstance(value, bool))
        if not ok:
            return [f"{where}: ожидался {expected_type}, пришло {type(value).__name__}"]
    if "const" in schema and value != schema["const"]:
        errors.append(f"{where}: ожидалось {schema['const']!r}, пришло {value!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{where}: {value!r} не из {schema['enum']}")
    if "minimum" in schema and isinstance(value, (int, float)) and value < schema["minimum"]:
        errors.append(f"{where}: {value} меньше {schema['minimum']}")
    if "maximum" in schema and isinstance(value, (int, float)) and value > schema["maximum"]:
        errors.append(f"{where}: {value} больше {schema['maximum']}")
    if isinstance(value, dict):
        for field in schema.get("required", []):
            if field not in value:
                errors.append(f"{where}: нет обязательного поля «{field}»")
        for field, sub in (schema.get("properties") or {}).items():
            if field in value:
                errors += validate(value[field], sub, f"{where}.{field}")
    if isinstance(value, list):
        if len(value) < schema.get("min_items", 0):
            errors.append(f"{where}: элементов {len(value)}, нужно не меньше {schema['min_items']}")
        if schema.get("items"):
            for i, item in enumerate(value[:5]):
                errors += validate(item, schema["items"], f"{where}[{i}]")
    return errors


# ---------- запуск ----------

def run(config_path, env, base_url_override=None):
    with open(config_path, encoding="utf-8") as f:
        config = yaml.safe_load(f)

    base_url = (base_url_override or config["base_url"]).rstrip("/")
    defaults = config.get("defaults", {})
    timeout = defaults.get("timeout_seconds", 30)
    roles = config.get("roles", {})
    saved = {}
    failed_required = 0

    print(f"{config['solution']['name']} · {base_url} · проверок: {len(config['checks'])}\n")

    for check in config["checks"]:
        started = time.time()
        problems = []
        try:
            role = roles.get(check.get("role", "none"), {})
            headers = {**defaults.get("headers", {}), **role.get("headers", {}), **check.get("headers", {})}
            headers = substitute(headers, env, saved)
            path = substitute(check["path"], env, saved)
            query = substitute(check.get("query") or {}, env, saved)
            body = substitute(check.get("body"), env, saved)

            url = base_url + path
            if query:
                url += "?" + urllib.parse.urlencode(query)
            data = json.dumps(body).encode() if body is not None else None
            request = urllib.request.Request(url, data=data, method=check["method"], headers=headers)

            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    status, raw, content_type = response.status, response.read(), response.headers.get("Content-Type", "")
            except urllib.error.HTTPError as e:
                status, raw, content_type = e.code, e.read(), e.headers.get("Content-Type", "")

            expect = check.get("expect", {})
            if status not in expect.get("status", [200]):
                problems.append(f"статус {status}, ожидался {expect.get('status')}")

            payload = None
            if raw:
                wanted_type = expect.get("content_type", defaults.get("response_content_type"))
                if wanted_type and wanted_type not in content_type:
                    problems.append(f"Content-Type «{content_type}», ожидался {wanted_type}")
                try:
                    payload = json.loads(raw)
                except ValueError:
                    problems.append("ответ не JSON")

            if payload is not None and not problems:
                problems += validate(payload, expect.get("body"))

            if not problems:
                for name, path_expr in (check.get("save") or {}).items():
                    saved[name] = json_path(payload, path_expr)
            elif payload is not None and status >= 400:
                problems.append(f"ответ: {json.dumps(payload, ensure_ascii=False)[:200]}")
        except Exception as e:  # сеть, подстановки, неверный путь save
            problems.append(str(e))

        ms = int((time.time() - started) * 1000)
        mark = "OK  " if not problems else "FAIL"
        print(f"[{mark}] {check['id']:<34} {check['method']:<6} {ms:>6} мс  {check['name']}")
        for p in problems:
            print(f"         └ {p}")
        if problems and check.get("required", True):
            failed_required += 1

    total = len(config["checks"])
    print(f"\nИтого: {total - failed_required} из {total} обязательных проверок прошли.")
    return failed_required == 0


def main():
    parser = argparse.ArgumentParser(description="Прогон проверок DATA-API.yaml")
    parser.add_argument("config", nargs="?", default="DATA-API.yaml")
    parser.add_argument("--env", help="файл .env с API_TEST_TOKEN_*")
    parser.add_argument("--base-url", help="заменить base_url из файла (например, http://localhost:3000/api)")
    args = parser.parse_args()

    env = dict(os.environ)
    if args.env:
        env.update(load_env_file(args.env))
    sys.exit(0 if run(args.config, env, args.base_url) else 1)


if __name__ == "__main__":
    main()
