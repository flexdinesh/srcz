# The zero CLI image, ghcr.io/flexdinesh/zero (decision 0125): the release
# archives' static binary on distroless, nothing compiled here. The build
# context holds <os>/<arch>/zero per platform, extracted from the archives
# (.github/workflows/build.yml).
FROM gcr.io/distroless/static:nonroot

ARG TARGETPLATFORM
COPY --chmod=0755 ${TARGETPLATFORM}/zero /zero

# Any --user can write its cache and config here; a uid with no passwd entry
# would otherwise get HOME=/.
ENV HOME=/tmp
WORKDIR /src
EXPOSE 7971

ENTRYPOINT ["/zero"]
CMD ["browser", "--host", "0.0.0.0", "--port", "7971", "--no-open", "."]
