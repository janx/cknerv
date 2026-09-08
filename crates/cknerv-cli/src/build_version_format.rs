/// Format the build version string as `<semver>@<short-hash>`,
/// e.g. `1.0.1@61922ba`. The same on every branch, without a branch label.
pub fn format_build_version(package_version: &str, commit_hash: &str) -> String {
    format!("{package_version}@{commit_hash}")
}

#[cfg(test)]
mod tests {
    use super::format_build_version;

    #[test]
    fn joins_package_version_and_commit_hash_with_at() {
        assert_eq!(format_build_version("1.0.1", "61922ba"), "1.0.1@61922ba");
    }

    #[test]
    fn contains_no_branch_or_plus_adornment() {
        let v = format_build_version("1.0.1", "61922ba");
        assert!(!v.contains('+'));
        assert_eq!(v.matches('@').count(), 1);
    }
}
