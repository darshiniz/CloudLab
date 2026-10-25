# Resource limit tests T-01 to T-05 (BRD section 13.4)

The BRD says the memory limit and the number of labs per worker must be **measured** before they are final. `infra/tests/resource-tests.js` runs the five tests against the real system and writes the results to `infra/tests/results/`.

| Test | What it does | Pass criterion |
|---|---|---|
| T-01 | Starts a Python, a Web and a Java lab one at a time, waits for the IDE to settle, reads `docker stats` | each at most 600 MB |
| T-02 | Runs a real task in each lab (pandas + matplotlib, `npm install` + a server, a Maven build with a 512 MB heap) while sampling memory | task completes, no out-of-memory kill |
| T-03 | 1 Python + 1 Web + 2 Java labs on ONE worker, all running a CPU and memory load for 30 minutes | no lab stopped, at least 300 MB free on the worker, each task at most 3x slower than alone |
| T-04 | Four Create Lab requests at the same moment | each lab Running within 30 s |
| T-05 | Makes a lab use more memory than its limit | only that lab is affected, the other 3 keep running; if the container itself dies the status is Stopped with reason Memory Limit |

## Before you run (all on the control VM)

1. The lab images must already be on both workers (`docker images | grep cloudlab` on each).
2. **For T-03 only:** all four labs must land on one worker. In **Admin > Infrastructure** press **Scale in** on worker-2 first (turn Automatic scaling off), run T-03, then **Scale out** again.
3. The test uses three student accounts (default `darshini@gbs.edu`, `simba@gbs.edu`, `anushka@gbs.edu`). They need free lab slots, so stop any labs those students have open.
4. The script needs the student password in an environment variable. Type it into the command; it is never printed or saved.

## Run

```bash
cd ~/cloudlab && git pull
# rehearsal: T-03 for 3 minutes instead of 30, all other tests real
sudo -u cloudlab env STUDENT_PASSWORD='the-student-password' DURATION_MIN=3 node infra/tests/resource-tests.js
# the real run (about 45 minutes):
sudo -u cloudlab env STUDENT_PASSWORD='the-student-password' node infra/tests/resource-tests.js
# one test only:   ... ONLY=T-04 node infra/tests/resource-tests.js
```

`cloudlab` is the service user that can SSH to the workers. If the script says it cannot reach Docker, check that user can run `docker -H ssh://cloudlab@WORKER_IP ps`.

The report is saved as `infra/tests/results/resource-tests-<date>.md`. Commit it (`git add infra/tests/results`) and copy the measured values into the BRD table, replacing "To be tested".

## Reading the result

* All pass: the memory limit and 4 labs per worker are final.
* T-01 / T-02 or the memory part of T-03 fails: BRD rule says use 1 GB per lab and 3 labs per worker (Admin > Inactivity Policy > "Max labs per worker").
* Only the slowdown part of T-03 fails: drop to 3 labs per worker.
* **INCONCLUSIVE** means the test could not be judged (for example T-03 labs were not all on one worker). It is not a pass.

## Honest notes for the viva

* The lab limits on Azure are 1 GB (Small) and 2 GB (Standard) on a 2 vCPU / 8 GB B2s_v2 worker, not the BRD's 768 MB on a 4 GB e2-medium. The test uses the size you choose with `SIZE=small|standard` and the same pass criteria.
* T-01 measures the IDE server with no browser tab attached; a real tab adds some memory.
* In T-05 a student's program that exceeds the limit is killed by the kernel while the lab itself usually stays up. The script also forces the IDE process to be the victim, to prove the platform marks a dead container Stopped with reason Memory Limit.
