---
name: git-recover-file
description: Recover the last valid version of a deleted, renamed, or corrupted file from a GitHub repository's commit history.
---

# Recovering Files from GitHub History
When you need to restore or recover a deleted, renamed, or overwritten file from a repository:
1. Search the commit history for that specific file path to see all commits that affected it:
   `GET /repos/{owner}/{repo}/commits?path={file_path}`
2. Identify the commit before the file was deleted or replaced with a redirect/backup.
3. Fetch the content of the file at that specific commit reference (`ref=SHA`) using GitHub's Repository Contents API or raw URL:
   `GET /repos/{owner}/{repo}/contents/{file_path}?ref={commit_sha}`
4. Write the retrieved base64-decoded content back to the destination file.
