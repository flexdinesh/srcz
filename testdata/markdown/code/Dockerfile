FROM golang:1.24 AS build
WORKDIR /src
COPY . .
RUN go build -o /zero .

FROM gcr.io/distroless/base
COPY --from=build /zero /zero
ENTRYPOINT ["/zero"]
