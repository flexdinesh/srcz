package contract

// Image is an image read (GET /api/image): a Markdown image dependency's or
// a commit's image bytes and media type. Over HTTP the body is the bytes, not JSON, and a
// failure is plain text.
type Image struct {
	MediaType string
	Content   []byte
}

// MaxImageBytes bounds the image a client reads; HTTP still streams any
// working-tree size to browsers, but never a larger image at a commit.
const MaxImageBytes = 32 << 20

// Image read messages.
const (
	// ImageUnavailableMessage reports any image that cannot be read: an
	// unknown project, path, or commit, a path the commit does not have, or
	// a file that is not an image.
	ImageUnavailableMessage = "That image is unavailable."
	ImageTooLargeMessage    = "That image is over 32 MiB."
)
