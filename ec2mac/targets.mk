# The hardware panel (ec2mac/README.md). Every target that can reach AWS
# refuses without CONFIRM=1; DRY_RUN=1 runs mac-up, mac-down and cpu-sweep
# printing the AWS calls they would make instead of making them.
#
#   make mac-up HOST=mac1 CONFIRM=1      allocates a host: 24 h minimum billing
#   make mac-up HOST=mac1 DRY_RUN=1      prints what that would do

.PHONY: mac-up mac-provision mac-run-panel mac-down cpu-sweep mac-panel-local mac-test

MACHOST := $(filter mac1 mac2,$(HOST))

define mac_guard
	@[ -n "$(MACHOST)" ] || { echo "$@: say HOST=mac1 or HOST=mac2"; exit 2; }
	@[ "$(CONFIRM)" = 1 ] || [ "$(DRY_RUN)" = 1 ] || { echo "$@ refused: it spends money. Rerun with CONFIRM=1, or DRY_RUN=1 to print the AWS calls."; exit 2; }
endef

mac-up:
	$(mac_guard)
	EC2MAC_HOST=$(MACHOST) DRY_RUN=$(DRY_RUN) ec2mac/up.sh
mac-provision:
	$(mac_guard)
	@[ "$(CONFIRM)" = 1 ] || { echo "$@ has no dry run; CONFIRM=1"; exit 2; }
	EC2MAC_HOST=$(MACHOST) ec2mac/provision.sh
mac-run-panel:
	$(mac_guard)
	@[ "$(CONFIRM)" = 1 ] || { echo "$@ has no dry run; CONFIRM=1"; exit 2; }
	EC2MAC_HOST=$(MACHOST) ec2mac/run.sh
mac-down:
	$(mac_guard)
	EC2MAC_HOST=$(MACHOST) DRY_RUN=$(DRY_RUN) ec2mac/down.sh

cpu-sweep:
	@[ "$(CONFIRM)" = 1 ] || [ "$(DRY_RUN)" = 1 ] || { echo "$@ refused: it drives the billed g4dn. Rerun with CONFIRM=1, or DRY_RUN=1."; exit 2; }
	DRY_RUN=$(DRY_RUN) ec2mac/cpusweep.sh

# No AWS: the parser fixture, and the panel against this box's port 8000.
mac-test:
	shellcheck -x -P SCRIPTDIR ec2mac/*.sh
	npx tsrs --noEmit -p ec2mac
	$(NODE) ec2mac/memtest.ts
mac-panel-local:
	RUNS=$(or $(RUNS),1) WARMUP=$(or $(WARMUP),0) $(NODE) ec2mac/panel.ts
