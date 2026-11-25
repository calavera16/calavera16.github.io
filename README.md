# Yeon Jun Kim’s portfolio

Follow an ASCII transmission to a receiving station in Seoul, then use the star chart to explore my work. The portfolio includes research on camera-based pulse measurement and sleep staging, alongside my entries in the Meta Global AI Developer Hackathon and NASA Space Apps Challenge. [Visit the portfolio](https://calavera16.github.io/)

## Run locally

The site uses plain HTML, CSS, and JavaScript. To preview it, start a local server from the repository root.

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open [localhost:8000](http://localhost:8000/). The [portfolio page](dist/portfolio.html) holds the project descriptions, research, and contact links. Pushing to the default branch runs the [GitHub Pages workflow](.github/workflows/pages.yml) and publishes `dist/` after the checks pass.

## License

You can reuse my original website code, including the ASCII animation and star chart logic, under the [MIT License](LICENSE). Portfolio writing, research materials, images, certificates, and third-party content, including embedded artwork and data, are outside the scope of this license and retain their existing rights.
