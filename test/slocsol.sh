#!/usr/bin/env bash
# Usage: ./slocsol.sh file1.sol [file2.sol ...]

count_sloc() {
    local file="$1"
    # Remove Windows CR, block comments, NatSpec, line comments, blanks, and lone braces
    local count=$(sed -E 's/\r//' "$file" | \
        sed -E '/\/\*/,/\*\//d' | \
        sed -E 's#//.*$##' | \
        sed -E 's#/\*\*.*\*/##' | \
        sed -E 's#^\s*///.*$##' | \
        grep -v '^[[:space:]]*$' | \
        grep -v '^[[:space:]]*[\{\}]$' | \
        wc -l)
    echo "$count"
}

if [ "$#" -eq 0 ]; then
    echo "Usage: $0 file1.sol [file2.sol ...]"
    exit 1
fi

total=0
for f in "$@"; do
    if [ ! -f "$f" ]; then
        echo "File not found: $f" >&2
        continue
    fi
    cnt=$(count_sloc "$f")
    echo "$f: $cnt"
    total=$((total + cnt))
done

if [ "$#" -gt 1 ]; then
    echo "TOTAL: $total"
fi
