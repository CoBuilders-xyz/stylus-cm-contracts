#!/usr/bin/env bash

set -euo pipefail

VM_NAME="arbitrum-test"
VM_IMAGE="jammy"
VM_CPUS="2"
VM_MEMORY="4G"
VM_DISK="30G"
MOUNT_SOURCE=""
MOUNT_TARGET="/home/ubuntu/project"
NITRO_DIR="/home/ubuntu/nitro-testnode"
NITRO_BRANCH="release"
RUN_INIT="true"
RUN_UP="false"

usage() {
  cat <<'EOF'
Usage: bootstrap-nitro-testnode-vm.sh [options]

Creates or reuses a Multipass VM, installs Docker inside it, clones
OffchainLabs/nitro-testnode, and optionally runs the init/start scripts.

Options:
  --name NAME           VM name (default: arbitrum-test)
  --image IMAGE         Ubuntu image for Multipass (default: jammy)
  --cpus N              VM CPUs (default: 2)
  --memory SIZE         VM memory (default: 4G)
  --disk SIZE           VM disk size (default: 30G)
  --mount-source PATH   Host path to mount into the VM
  --mount-target PATH   VM mount target (default: /home/ubuntu/project)
  --nitro-dir PATH      nitro-testnode clone path in the VM
  --branch NAME         nitro-testnode branch (default: release)
  --skip-init           Do not run ./test-node.bash --init
  --run-up              Run ./test-node.bash --up after init
  -h, --help            Show this help

Examples:
  ./test/utils/bootstrap-nitro-testnode-vm.sh --mount-source "$PWD"
  ./test/utils/bootstrap-nitro-testnode-vm.sh --name nitro-vm --run-up
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      VM_NAME="$2"
      shift 2
      ;;
    --image)
      VM_IMAGE="$2"
      shift 2
      ;;
    --cpus)
      VM_CPUS="$2"
      shift 2
      ;;
    --memory)
      VM_MEMORY="$2"
      shift 2
      ;;
    --disk)
      VM_DISK="$2"
      shift 2
      ;;
    --mount-source)
      MOUNT_SOURCE="$2"
      shift 2
      ;;
    --mount-target)
      MOUNT_TARGET="$2"
      shift 2
      ;;
    --nitro-dir)
      NITRO_DIR="$2"
      shift 2
      ;;
    --branch)
      NITRO_BRANCH="$2"
      shift 2
      ;;
    --skip-init)
      RUN_INIT="false"
      shift
      ;;
    --run-up)
      RUN_UP="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd multipass

vm_exists() {
  multipass info "$VM_NAME" >/dev/null 2>&1
}

vm_is_running() {
  multipass info "$VM_NAME" --format json 2>/dev/null | rg -q '"state":\s*"Running"'
}

run_in_vm() {
  local cmd="$1"
  multipass exec "$VM_NAME" -- bash -lc "$cmd"
}

echo "==> Ensuring VM $VM_NAME exists"
if ! vm_exists; then
  multipass launch \
    --name "$VM_NAME" \
    --cpus "$VM_CPUS" \
    --memory "$VM_MEMORY" \
    --disk "$VM_DISK" \
    "$VM_IMAGE"
fi

if ! vm_is_running; then
  multipass start "$VM_NAME"
fi

echo "==> Installing base packages in VM"
run_in_vm "sudo apt-get update"
run_in_vm "sudo apt-get install -y ca-certificates curl git gnupg jq"

echo "==> Installing Docker in VM if needed"
run_in_vm '
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  source /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo usermod -aG docker ubuntu
'

echo "==> Cloning nitro-testnode"
run_in_vm "
if [ ! -d '$NITRO_DIR/.git' ]; then
  git clone -b '$NITRO_BRANCH' --recurse-submodules https://github.com/OffchainLabs/nitro-testnode.git '$NITRO_DIR'
else
  git -C '$NITRO_DIR' fetch origin '$NITRO_BRANCH'
  git -C '$NITRO_DIR' checkout '$NITRO_BRANCH'
  git -C '$NITRO_DIR' pull --ff-only origin '$NITRO_BRANCH'
  git -C '$NITRO_DIR' submodule update --init --recursive
fi
"

if [[ -n "$MOUNT_SOURCE" ]]; then
  echo "==> Mounting $MOUNT_SOURCE into $VM_NAME:$MOUNT_TARGET"
  if ! multipass info "$VM_NAME" --format json | rg -q "\"$MOUNT_TARGET\""; then
    multipass mount "$MOUNT_SOURCE" "$VM_NAME:$MOUNT_TARGET"
  fi
fi

if [[ "$RUN_INIT" == "true" ]]; then
  echo "==> Running nitro-testnode init"
  run_in_vm "cd '$NITRO_DIR' && sg docker -c './test-node.bash --init'"
fi

if [[ "$RUN_UP" == "true" ]]; then
  echo "==> Starting nitro-testnode"
  run_in_vm "cd '$NITRO_DIR' && sg docker -c './test-node.bash --up'"
fi

cat <<EOF

VM ready: $VM_NAME
nitro-testnode dir: $NITRO_DIR

Useful commands:
  multipass shell $VM_NAME
  multipass exec $VM_NAME -- bash -lc "cd '$NITRO_DIR' && sg docker -c './test-node.bash --help'"
  multipass exec $VM_NAME -- bash -lc "cd '$NITRO_DIR' && sg docker -c './test-node.bash --up'"
  multipass exec $VM_NAME -- bash -lc "cd '$NITRO_DIR' && sg docker -c './test-node.bash --down'"

To change the VM clock later:
  multipass exec $VM_NAME -- sudo timedatectl set-ntp false
  multipass exec $VM_NAME -- sudo date -s '+25 hours'

EOF
