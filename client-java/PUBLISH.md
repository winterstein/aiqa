# Publishing to Maven Central

## Quick Update

```bash
mvn clean deploy
```

## Prerequisites

1. **Sonatype Account**: Create an account at https://issues.sonatype.org/
2. **GPG Key**: Generate a GPG key for signing artifacts:
   ```bash
   gpg --gen-key
   gpg --keyserver keyserver.ubuntu.com --send-keys YOUR_KEY_ID
   ```
3. **Repository Access**: Request access to the `dev.aiqa` group ID via Sonatype JIRA

## Configuration

### 1. Add Distribution Management to pom.xml

Add this section to your `pom.xml` (already included if using the template):

```xml
<distributionManagement>
    <snapshotRepository>
        <id>ossrh</id>
        <name>OSSRH Snapshots</name>
        <url>https://s01.oss.sonatype.org/content/repositories/snapshots</url>
    </snapshotRepository>
    <repository>
        <id>ossrh</id>
        <name>OSSRH Release</name>
        <url>https://s01.oss.sonatype.org/service/local/staging/deploy/maven2/</url>
    </repository>
</distributionManagement>
```

### 2. Configure Maven Settings

Add to `~/.m2/settings.xml`:

```xml
<settings>
    <servers>
        <server>
            <id>ossrh</id>
            <username>YOUR_SONATYPE_USERNAME</username>
            <password>YOUR_SONATYPE_PASSWORD</password>
        </server>
    </servers>
</settings>
```

### 3. Add GPG Plugin

The `pom.xml` should include the GPG plugin (add if missing):

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-gpg-plugin</artifactId>
    <version>3.0.1</version>
    <executions>
        <execution>
            <id>sign-artifacts</id>
            <phase>verify</phase>
            <goals>
                <goal>sign</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

## Building and Publishing

### Snapshot Releases

For snapshot versions (e.g., `0.1.0-SNAPSHOT`):

```bash
mvn clean deploy
```

Snapshots are automatically published to https://s01.oss.sonatype.org/content/repositories/snapshots/

### Production Releases

1. **Update Version**: Remove `-SNAPSHOT` from version in `pom.xml`

2. **Build and Deploy**:
   ```bash
   mvn clean deploy
   ```

3. **Release via Sonatype Nexus**:
   - Go to https://s01.oss.sonatype.org/
   - Login with your Sonatype credentials
   - Navigate to "Staging Repositories"
   - Find your repository (e.g., `devaiqa-XXXX`)
   - Click "Close" to validate
   - After validation, click "Release" to publish to Maven Central

4. **Update Version**: Increment version and add `-SNAPSHOT` for next development cycle

## Alternative: Publishing to GitHub Packages

For simpler setup, you can publish to GitHub Packages:

### 1. Add to pom.xml

```xml
<distributionManagement>
    <repository>
        <id>github</id>
        <name>GitHub Packages</name>
        <url>https://maven.pkg.github.com/winterstein/aiqa</url>
    </repository>
</distributionManagement>
```

### 2. Configure Settings

Add to `~/.m2/settings.xml`:

```xml
<servers>
    <server>
        <id>github</id>
        <username>YOUR_GITHUB_USERNAME</username>
        <password>YOUR_GITHUB_TOKEN</password>
    </server>
</servers>
```

### 3. Deploy

```bash
mvn clean deploy
```

### 4. User Installation

Users can then install by adding to their `pom.xml`:

```xml
<repositories>
    <repository>
        <id>github</id>
        <url>https://maven.pkg.github.com/winterstein/aiqa</url>
    </repository>
</repositories>

<dependencies>
    <dependency>
        <groupId>dev.aiqa</groupId>
        <artifactId>aiqa-client</artifactId>
        <version>0.1.0</version>
    </dependency>
</dependencies>
```

And configure authentication in `~/.m2/settings.xml`:

```xml
<settings>
    <servers>
        <server>
            <id>github</id>
            <username>YOUR_GITHUB_USERNAME</username>
            <password>YOUR_GITHUB_TOKEN</password>
        </server>
    </servers>
</settings>
```

**Note**: Users need a GitHub Personal Access Token with `read:packages` permission. They can create one at https://github.com/settings/tokens

## Version Updates

To publish a new version:

1. Update version in `pom.xml`:
   ```xml
   <version>0.1.1</version>
   ```

2. Build and deploy:
   ```bash
   mvn clean deploy
   ```

## Automated Publishing

For CI/CD (GitHub Actions example):

```yaml
name: Publish
on:
  release:
    types: [created]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-java@v3
        with:
          java-version: '11'
          distribution: 'temurin'
      - name: Configure GPG
        run: |
          echo "${{ secrets.GPG_PRIVATE_KEY }}" | gpg --import
      - name: Publish to Maven Central
        env:
          OSSRH_USERNAME: ${{ secrets.OSSRH_USERNAME }}
          OSSRH_PASSWORD: ${{ secrets.OSSRH_PASSWORD }}
        run: mvn clean deploy
```

## Notes

- Maven Central requires signed artifacts (GPG)
- First-time releases may take several hours to appear in Maven Central search
- Ensure all required metadata (name, description, license, etc.) is in `pom.xml`
- For simpler setup, consider GitHub Packages or JitPack

