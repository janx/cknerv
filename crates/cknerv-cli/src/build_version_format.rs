/// Format the build version string as `<commit-date>@<short-hash>`,
/// e.g. `20260630@61922ba`. The same on every branch — no semver, no branch label.
pub fn format_build_version(commit_date: &str, commit_hash: &str) -> String {
    format!("{commit_date}@{commit_hash}")
}

#[cfg(test)]
mod tests {
    use super::format_build_version;

    #[test]
    fn joins_commit_date_and_hash_with_at() {
        assert_eq!(
            format_build_version("20260630", "61922ba"),
            "20260630@61922ba"
        );
    }

    #[test]
    fn contains_no_branch_or_plus_adornment() {
        let v = format_build_version("20260630", "61922ba");
        assert!(!v.contains('+'));
        assert_eq!(v.matches('@').count(), 1);
    }
}
