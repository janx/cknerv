/// Format the build version string as `<short-hash>@<commit-date>`,
/// e.g. `61922ba@20260630`. Leading with the hash keeps the string from reading
/// as a bare number blob. The same on every branch — no semver, no branch label.
pub fn format_build_version(commit_date: &str, commit_hash: &str) -> String {
    format!("{commit_hash}@{commit_date}")
}

#[cfg(test)]
mod tests {
    use super::format_build_version;

    #[test]
    fn joins_hash_and_commit_date_with_at() {
        assert_eq!(
            format_build_version("20260630", "61922ba"),
            "61922ba@20260630"
        );
    }

    #[test]
    fn contains_no_branch_or_plus_adornment() {
        let v = format_build_version("20260630", "61922ba");
        assert!(!v.contains('+'));
        assert_eq!(v.matches('@').count(), 1);
    }
}
