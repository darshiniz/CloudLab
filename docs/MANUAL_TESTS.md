# Manual acceptance tests on the live site

Use two browser windows (one normal, one private) so you can be faculty and student at the same time.

## 1. Activity, work across two days, submit, marks (assignments)

1. **Faculty** (`coco@gbs.edu`): **Assign Activity**. Title "Loops practice", lab template **Python**, due date tomorrow, **Maximum marks 20**, Assign to **Whole class**. Press **Assign activity**.
2. **Student** (`darshini@gbs.edu`): **Assignments**. "Loops practice" is under **To do**, status **Not started**. Press **Start lab**, create the lab, open it.
3. In the lab IDE create `loops.py` containing `print("hello")` and save it (Ctrl+S).
4. Back in CloudLab press **Stop** on the lab (My Labs). Return to **Assignments**: status must say **In progress** (not Submitted).
5. Start the lab again (My Labs > Start, or **Resume in My Labs**). `loops.py` must still be there.
6. **Assignments > Submit**, type the note "Finished, please check", press **Submit**. The activity moves to **Submitted** and shows "Not graded yet".
7. **Faculty**: **Assign Activity** > on "Loops practice" press **View submissions**. Darshini shows **Submitted**, with the note "Finished, please check".
8. Press **View files**: `loops.py` is listed; press **Download** and open the file.
9. Press **Grade**, enter marks 17, feedback "Good use of loops", **Save marks**. The row now says "17/20 marks".
10. **Student**: **Assignments**: under **Submitted** the card shows "Marks: 17 / 20" and the feedback.

## 2. Self-registration with approval

1. Log out. On the sign-in page press **Create an account**. Register with an `@gbs.edu` address, a roll number and a password of at least 8 characters.
2. You see "Registration received". Try to sign in: the message says it is waiting for administrator approval.
3. Try registering with a `@gmail.com` address: refused ("must be an @gbs.edu address").
4. **Admin** (`admin@gbs.edu`) > **User Management**: the new student is under **Waiting for approval**. Press **Approve**. The user table shows "Approved by Administrator".
5. The student can now sign in. (Press **Reject** instead to see a rejected account refused.)
6. The student cap is 15 (active + pending). The 16th registration is refused with "Registration is closed".

## 3. Data Science lab

**Lab Catalog** now shows **Data Science** as launchable (it needs the image built on both workers: DEPLOYMENT_AZURE.md, Part 3D). Create one and run `python3 -c "import pandas, sklearn, statsmodels; print('ok')"` and `R --version` in its terminal.

## 4. Daily schedule and weekly backup

* 16:55 IST: labs still running are stopped automatically (Admin > Active Environments shows them Stopped; the student gets the message "stopped by the daily scheduled shutdown").
* 17:00 IST: all three VMs shut down; 08:50 IST next weekday they start again. In Admin > Infrastructure the scaling log shows lines with source "schedule".
* Friday 16:30 IST: `ls -lh /mnt/cloudlab/archive` shows a new `workspaces-<date>.tar.gz`; only the newest 4 are kept. To test now: `sudo systemctl start cloudlab-backup`.
